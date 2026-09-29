from __future__ import annotations

from dataclasses import asdict
from fastapi import APIRouter, Header, HTTPException, Request

from app.repositories.ingest_jobs import IngestJobRecord
from app.routes.ingest import SUPPORTED_NATIVE_ARTIFACTS, _job_payload
from app.security.authorization import require_permission, resolve_actor
from app.services.knowledge_ingestion import build_knowledge_item, store_knowledge_item


router = APIRouter(prefix="/api/tenants/{tenant_id}/tools/ailogscope", tags=["AILogScope"])
MAX_LOG_UPLOAD_BYTES = 25 * 1024 * 1024


@router.post("/jobs")
async def create_log_job(tenant_id: int, body: dict, request: Request, x_actor: str | None = Header(default=None), x_role: str | None = Header(default=None)):
    actor = require_permission(resolve_actor(tenant_id, x_actor, x_role), "ingest.jobs.create")
    name = str(body.get("artifact_name", "")).strip()
    artifact_type = str(body.get("artifact_type", "")).strip().lower().lstrip(".")
    if not name or artifact_type not in SUPPORTED_NATIVE_ARTIFACTS["ailogscope"]["artifact_types"]:
        raise HTTPException(status_code=400, detail="AILogScope accepts log, txt, json, yaml, or pdf artifacts")
    record = IngestJobRecord(tenant_id=tenant_id, tool_id="ailogscope", artifact_name=name, artifact_type=artifact_type, requested_by=actor.actor_id, normalized_schema="datasnare-ailogscope/events-v1", native_conversion={"schema": "datasnare-ingest/native-conversion-v1", "strategy": "logscope-document-python-job", "status": "planned"})
    saved = await request.app.state.ingest_jobs.create(record)
    return {"schema": "datasnare-ailogscope/job-v1", "job": _job_payload(saved), "next": "upload-artifact"}


@router.post("/jobs/{job_id}/artifact")
async def upload_log_artifact(tenant_id: int, job_id: str, request: Request, x_actor: str | None = Header(default=None), x_role: str | None = Header(default=None)):
    actor = require_permission(resolve_actor(tenant_id, x_actor, x_role), "ingest.jobs.create")
    record = await request.app.state.ingest_jobs.get(tenant_id, job_id)
    if not record or record.tool_id != "ailogscope":
        raise HTTPException(status_code=404, detail="AILogScope log job not found")
    content_length = request.headers.get("content-length")
    try:
        declared_size = int(content_length) if content_length else None
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Invalid Content-Length header") from error
    if declared_size is not None and declared_size > MAX_LOG_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="AILogScope staging uploads are limited to 25 MiB")
    data = await request.body()
    if len(data) > MAX_LOG_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="AILogScope staging uploads are limited to 25 MiB")
    await request.app.state.ingest_jobs.update(tenant_id, job_id, state="running")
    try:
        analysis = await request.app.state.log_parser.analyze(data, record.artifact_name)
    except ValueError as error:
        await request.app.state.ingest_jobs.update(tenant_id, job_id, state="failed", native_conversion={**(record.native_conversion or {}), "status": "failed", "error": str(error)})
        raise HTTPException(status_code=422, detail=str(error)) from error
    item = build_knowledge_item(tenant_id, actor.actor_id, item_type="log", source_id=job_id, source_name=record.artifact_name, title=record.artifact_name, text=analysis.knowledge_text, agent_id=None, site_id=None, area_id=None, classification="internal", metadata={"tool_id": "ailogscope", "parser": analysis.parser, "event_count": analysis.events, "severity_counts": analysis.severity_counts})
    await store_knowledge_item(request, tenant_id=tenant_id, actor_id=actor.actor_id, item=item)
    analysis_payload = asdict(analysis)
    analysis_payload.pop("knowledge_text", None)
    completed = await request.app.state.ingest_jobs.update(tenant_id, job_id, state="completed", native_conversion={**(record.native_conversion or {}), "status": "completed", "analysis": analysis_payload, "knowledge_item_id": item.item_id})
    return {"schema": "datasnare-ailogscope/job-result-v1", "job": _job_payload(completed), "analysis": analysis_payload, "knowledge_item_id": item.item_id}
