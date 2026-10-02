from __future__ import annotations

import json
from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.routes.ingest import SUPPORTED_NATIVE_ARTIFACTS
from app.security.authorization import require_permission, resolve_actor
from app.services.analysis_plugin_contract import (
    EVIDENCE_ENVELOPE_SCHEMA,
    FIRST_PARTY_PLUGIN_MANIFESTS,
    PLUGIN_CONTRACT_SCHEMA,
    normalized_plugin_evidence_envelope,
)


router = APIRouter(prefix="/api/projects", tags=["Projects"])
analysis_router = APIRouter(prefix="/api/tenants/{tenant_id}/analysis", tags=["AIAnalysis"])
ANALYSIS_PLUGIN_IDS = {"ailogscope", "aiperf", "aiprocmon", "ainetscope"}


class InvestigationMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")
    incident_at: datetime | None = None
    incident_description: str = Field(default="", max_length=4000)
    working_note: str = Field(default="", max_length=4000)
    window_start: datetime | None = None
    window_end: datetime | None = None

    @field_validator("incident_at", "window_start", "window_end")
    @classmethod
    def require_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.utcoffset() is None:
            raise ValueError("Datetimes must include a timezone offset")
        return value

    @model_validator(mode="after")
    def validate_window(self):
        if (self.window_start is None) != (self.window_end is None):
            raise ValueError("Provide both investigation window endpoints")
        if self.window_start is not None and self.window_end <= self.window_start:
            raise ValueError("Investigation window end must follow its start")
        return self


class AnalysisInvestigationCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=4000)
    evidence_job_ids: list[str] = Field(min_length=1, max_length=20)
    metadata: InvestigationMetadata = Field(default_factory=InvestigationMetadata)

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        title = value.strip()
        if not title:
            raise ValueError("Investigation title is required")
        return title

    @field_validator("evidence_job_ids")
    @classmethod
    def require_unique_evidence(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("Evidence job IDs must be unique")
        return value


def _investigation_payload(row, *, include_evidence: bool = False):
    payload = {
        "investigation_id": row["investigation_id"],
        "tenant_id": row["tenant_id"],
        "title": row["title"],
        "description": row["description"],
        "status": row["status"],
        "created_by": row["created_by"],
        "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
        "updated_at": row["updated_at"].isoformat() if row.get("updated_at") else None,
    }
    metadata = row.get("metadata") or {}
    payload["metadata"] = json.loads(metadata) if isinstance(metadata, str) else dict(metadata)
    if include_evidence:
        evidence = row.get("evidence") or []
        payload["evidence"] = json.loads(evidence) if isinstance(evidence, str) else evidence
    else:
        payload["evidence_count"] = int(row.get("evidence_count") or 0)
    return payload


def _evidence_snapshot(job) -> dict:
    conversion = job.native_conversion or {}
    envelope = conversion.get("evidence_envelope") or _legacy_job_envelope(job, conversion)
    if job.state != "completed" or not envelope:
        raise HTTPException(
            status_code=409,
            detail=f"Evidence job {job.job_id} is not completed or has no normalized evidence",
        )
    events = []
    for event in (envelope.get("events") or [])[:20]:
        source = event.get("evidence") or {}
        events.append({
            "timestamp": event.get("timestamp"),
            "severity": event.get("severity") or "info",
            "category": event.get("category"),
            "host": event.get("host"),
            "process": event.get("process"),
            "summary": str(event.get("summary") or "")[:320],
            "evidence": {
                key: source[key]
                for key in ("sourceFile", "sourceLine", "packetNumber")
                if key in source
            },
        })
    return {
        "job_id": job.job_id,
        "plugin_id": job.tool_id,
        "plugin_version": envelope.get("plugin_version"),
        "artifact_name": job.artifact_name,
        "artifact_type": job.artifact_type,
        "source_schema": envelope.get("source_schema") or job.normalized_schema,
        "event_count": int((envelope.get("metadata") or {}).get("event_count") or (envelope.get("metadata") or {}).get("packets") or 0),
        "finding_count": len(envelope.get("findings") or []),
        **_event_time_range(envelope),
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "events": events,
    }


def _event_time_range(envelope: dict) -> dict:
    timestamps = []
    for event in envelope.get("events") or []:
        value = event.get("timestamp")
        if not isinstance(value, str):
            continue
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.utcoffset() is not None:
                timestamps.append(parsed)
        except ValueError:
            continue
    return {
        "start_time": min(timestamps).isoformat() if timestamps else None,
        "end_time": max(timestamps).isoformat() if timestamps else None,
        "time_range_scope": "stored_event_sample",
    }


def _legacy_job_envelope(job, conversion: dict) -> dict | None:
    analysis = conversion.get("analysis")
    if job.state != "completed" or not isinstance(analysis, dict):
        return None
    preview = analysis.get("preview")
    if not isinstance(preview, list):
        preview = analysis.get("events")
    if not isinstance(preview, list):
        preview = []
    raw_count = analysis.get("event_count")
    if not isinstance(raw_count, int):
        raw_count = analysis.get("events") if isinstance(analysis.get("events"), int) else None
    if raw_count is None:
        raw_count = analysis.get("packets") or analysis.get("records") or len(preview)
    metadata = {
        "event_count": int(raw_count),
        "severity_counts": analysis.get("severity_counts") or {},
        "parser": analysis.get("parser"),
        "source_encoding": analysis.get("source_encoding"),
        "packets": analysis.get("packets"),
    }
    return normalized_plugin_evidence_envelope(
        tenant_id=job.tenant_id,
        plugin_id=job.tool_id,
        plugin_version="0.1.0",
        job_id=job.job_id,
        artifact_name=job.artifact_name,
        source_schema=analysis.get("schema") or job.normalized_schema or f"datasnare-{job.tool_id}/events-v1",
        events=preview,
        findings=analysis.get("findings") or [],
        metadata=metadata,
    ).model_dump(by_alias=True)


@router.get("/web-migrations")
async def web_migrations():
    return {
        "schema": "datasnare-core/web-migrations-v1",
        "projects": [
            {
                "project_id": project_id,
                "frontend": "react",
                "backend": "python",
                "status": "contract-ready",
                "artifact_types": sorted(config["artifact_types"]),
                "normalized_schema": config["normalized_schema"],
                "converter": config["converter"],
            }
            for project_id, config in sorted(SUPPORTED_NATIVE_ARTIFACTS.items())
        ],
    }


@router.get("/analysis-plugins")
async def analysis_plugins():
    return {
        "schema": "datasnare-core/analysis-plugin-catalog-v1",
        "plugin_contract": PLUGIN_CONTRACT_SCHEMA,
        "evidence_envelope": EVIDENCE_ENVELOPE_SCHEMA,
        "execution_enabled": False,
        "plugins": [
            manifest.model_dump(by_alias=True)
            for _, manifest in sorted(FIRST_PARTY_PLUGIN_MANIFESTS.items())
        ],
    }


@analysis_router.get("/evidence")
async def tenant_analysis_evidence(
    tenant_id: int,
    request: Request,
    limit: int = 30,
    events_per_item: int = 10,
    x_actor: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
):
    actor = require_permission(
        await resolve_actor(tenant_id, x_actor, x_role, request=request),
        "ingest.jobs.view",
    )
    jobs = await request.app.state.ingest_jobs.list_for_tenant(tenant_id)
    evidence = []
    max_items = max(1, min(limit, 100))
    max_events = max(1, min(events_per_item, 20))
    for job in jobs:
        if job.tool_id not in ANALYSIS_PLUGIN_IDS:
            continue
        conversion = job.native_conversion or {}
        envelope = conversion.get("evidence_envelope") or _legacy_job_envelope(job, conversion) or {}
        if not envelope:
            continue
        metadata = envelope.get("metadata") or {}
        timestamps = []
        for event in envelope.get("events") or []:
            value = event.get("timestamp")
            if not value:
                continue
            try:
                parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
                if parsed.tzinfo is not None:
                    timestamps.append(parsed)
            except (ValueError, TypeError):
                continue
        event_preview = []
        for event in (envelope.get("events") or [])[:max_events]:
            event_evidence = event.get("evidence") or {}
            event_preview.append({
                "timestamp": event.get("timestamp"),
                "severity": event.get("severity") or "info",
                "category": event.get("category"),
                "host": event.get("host"),
                "process": event.get("process"),
                "summary": str(event.get("summary") or "")[:320],
                "evidence": {
                    key: event_evidence[key]
                    for key in ("sourceFile", "sourceLine", "packetNumber")
                    if key in event_evidence
                },
            })
        evidence.append({
            "tenant_id": tenant_id,
            "job_id": job.job_id,
            "plugin_id": job.tool_id,
            "plugin_version": envelope.get("plugin_version"),
            "artifact_name": job.artifact_name,
            "artifact_type": job.artifact_type,
            "state": job.state,
            "created_at": job.created_at.isoformat() if job.created_at else None,
            "start_time": min(timestamps).isoformat() if timestamps else None,
            "end_time": max(timestamps).isoformat() if timestamps else None,
            "time_range_scope": "stored_event_sample",
            "source_schema": envelope.get("source_schema") or job.normalized_schema,
            "event_count": int(metadata.get("event_count") or metadata.get("packets") or metadata.get("events") or metadata.get("records") or 0),
            "severity_counts": metadata.get("severity_counts") or {},
            "finding_count": len(envelope.get("findings") or []),
            "event_preview": event_preview,
            "knowledge_item_id": conversion.get("knowledge_item_id"),
        })
        if len(evidence) >= max_items:
            break
    return {
        "schema": "datasnare-analysis/evidence-catalog-v1",
        "tenant_id": tenant_id,
        "requested_by": actor.actor_id,
        "items": evidence,
    }


@analysis_router.post("/investigations", status_code=201)
async def create_analysis_investigation(
    tenant_id: int,
    body: AnalysisInvestigationCreate,
    request: Request,
    x_actor: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
):
    actor = require_permission(
        await resolve_actor(tenant_id, x_actor, x_role, request=request),
        "ingest.jobs.create",
    )
    pool = getattr(request.app.state, "database_pool", None)
    if pool is None:
        raise HTTPException(status_code=503, detail="Persistent investigation storage is not configured")

    snapshots = []
    for job_id in body.evidence_job_ids:
        job = await request.app.state.ingest_jobs.get(tenant_id, job_id)
        if not job or job.tool_id not in ANALYSIS_PLUGIN_IDS:
            raise HTTPException(status_code=404, detail=f"Analysis evidence job {job_id} was not found for this tenant")
        snapshots.append(_evidence_snapshot(job))

    investigation_id = str(uuid4())
    row = await pool.fetchrow(
        """
        INSERT INTO analysis_investigations
            (investigation_id, tenant_id, title, description, evidence, created_by, metadata)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb)
        RETURNING investigation_id, tenant_id, title, description, status,
                  evidence, created_by, created_at, updated_at, metadata
        """,
        investigation_id,
        tenant_id,
        body.title,
        body.description.strip(),
        json.dumps(snapshots, separators=(",", ":")),
        actor.actor_id,
        body.metadata.model_dump_json(),
    )
    return _investigation_payload(row, include_evidence=True)


@analysis_router.get("/investigations")
async def list_analysis_investigations(
    tenant_id: int,
    request: Request,
    limit: int = 20,
    x_actor: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
):
    require_permission(
        await resolve_actor(tenant_id, x_actor, x_role, request=request),
        "ingest.jobs.view",
    )
    pool = getattr(request.app.state, "database_pool", None)
    if pool is None:
        raise HTTPException(status_code=503, detail="Persistent investigation storage is not configured")
    rows = await pool.fetch(
        """
        SELECT investigation_id, tenant_id, title, description, status, created_by, metadata,
               created_at, updated_at, jsonb_array_length(evidence) AS evidence_count
        FROM analysis_investigations
        WHERE tenant_id = $1
        ORDER BY updated_at DESC
        LIMIT $2
        """,
        tenant_id,
        max(1, min(limit, 100)),
    )
    return {
        "schema": "datasnare-analysis/investigation-list-v1",
        "tenant_id": tenant_id,
        "investigations": [_investigation_payload(row) for row in rows],
    }


@analysis_router.get("/investigations/{investigation_id}")
async def get_analysis_investigation(
    tenant_id: int,
    investigation_id: str,
    request: Request,
    x_actor: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
):
    require_permission(
        await resolve_actor(tenant_id, x_actor, x_role, request=request),
        "ingest.jobs.view",
    )
    pool = getattr(request.app.state, "database_pool", None)
    if pool is None:
        raise HTTPException(status_code=503, detail="Persistent investigation storage is not configured")
    row = await pool.fetchrow(
        """
        SELECT investigation_id, tenant_id, title, description, status, evidence, metadata,
               created_by, created_at, updated_at
        FROM analysis_investigations
        WHERE tenant_id = $1 AND investigation_id = $2
        """,
        tenant_id,
        investigation_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Investigation not found")
    return _investigation_payload(row, include_evidence=True)