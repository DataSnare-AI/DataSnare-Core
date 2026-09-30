from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from app.repositories.ingest_jobs import IngestJobRecord
from app.security.authorization import require_permission, resolve_actor


router = APIRouter(prefix="/api/tenants/{tenant_id}/ingest/jobs", tags=["Ingest"])


SUPPORTED_NATIVE_ARTIFACTS = {
    "ailogscope": {
        "artifact_types": {"log", "txt", "json", "yaml", "pdf"},
        "normalized_schema": "datasnare-ailogscope/events-v1",
        "converter": "logscope-document-python-job",
    },
    "aiperf": {
        "artifact_types": {"blg", "csv", "xml"},
        "normalized_schema": "datasnare-aiperf/events-v1",
        "converter": "perfmon-blg-python-job",
    },
    "aiprocmon": {
        "artifact_types": {"pml", "csv", "xml"},
        "normalized_schema": "datasnare-aiprocmon/events-v1",
        "converter": "procmon-native-python-job",
    },
    "ainetscope": {
        "artifact_types": {"pcap", "pcapng", "cap"},
        "normalized_schema": "datasnare-ainetscope/analysis-v1",
        "converter": "netscope-packet-python-job",
    },
}


class IngestJobCreateRequest(BaseModel):
    tool_id: str = Field(min_length=1)
    artifact_name: str = Field(min_length=1)
    artifact_type: str = Field(min_length=1)

    @field_validator("tool_id", "artifact_type")
    @classmethod
    def normalize_identifier(cls, value: str) -> str:
        return value.strip().lower().lstrip(".")

    @field_validator("artifact_name")
    @classmethod
    def normalize_artifact_name(cls, value: str) -> str:
        return value.strip()


def _job_payload(record: IngestJobRecord):
    return {
        "schema": record.schema,
        "tenant_id": record.tenant_id,
        "job_id": record.job_id,
        "tool_id": record.tool_id,
        "artifact_name": record.artifact_name,
        "artifact_type": record.artifact_type,
        "state": record.state,
        "requested_by": record.requested_by,
        "created_at": record.created_at.isoformat() if record.created_at else None,
        "updated_at": record.updated_at.isoformat() if record.updated_at else None,
        "normalized_schema": record.normalized_schema,
        "native_conversion": record.native_conversion,
    }


def _native_conversion(tool_id: str, artifact_type: str) -> dict:
    support = SUPPORTED_NATIVE_ARTIFACTS.get(tool_id)
    if not support or artifact_type not in support["artifact_types"]:
        supported = ", ".join(
            f"{tool}:{'/'.join(sorted(config['artifact_types']))}"
            for tool, config in sorted(SUPPORTED_NATIVE_ARTIFACTS.items())
        )
        raise HTTPException(status_code=400, detail=f"Unsupported ingest artifact. Supported: {supported}")
    return {
        "schema": "datasnare-ingest/native-conversion-v1",
        "strategy": support["converter"],
        "status": "planned",
        "message": "Native conversion is queued by contract only; parser execution is not implemented in this stub.",
    }


@router.post("")
async def create_ingest_job(
    tenant_id: int,
    body: IngestJobCreateRequest,
    request: Request,
    x_actor: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
):
    actor_context = require_permission(await resolve_actor(tenant_id, x_actor, x_role, request=request), "ingest.jobs.create")
    support = SUPPORTED_NATIVE_ARTIFACTS.get(body.tool_id)
    conversion = _native_conversion(body.tool_id, body.artifact_type)
    record = IngestJobRecord(
        tenant_id=tenant_id,
        tool_id=body.tool_id,
        artifact_name=body.artifact_name,
        artifact_type=body.artifact_type,
        requested_by=actor_context.actor_id,
        normalized_schema=support["normalized_schema"] if support else None,
        native_conversion=conversion,
    )
    saved = await request.app.state.ingest_jobs.create(record)
    return _job_payload(saved)


@router.get("")
async def list_ingest_jobs(tenant_id: int, request: Request, x_actor: str | None = Header(default=None), x_role: str | None = Header(default=None)):
    require_permission(await resolve_actor(tenant_id, x_actor, x_role, request=request), "ingest.jobs.view")
    records = await request.app.state.ingest_jobs.list_for_tenant(tenant_id)
    return {"schema": "datasnare-ingest/job-list-v1", "tenant_id": tenant_id, "jobs": [_job_payload(record) for record in records]}


@router.get("/{job_id}")
async def get_ingest_job(tenant_id: int, job_id: str, request: Request, x_actor: str | None = Header(default=None), x_role: str | None = Header(default=None)):
    require_permission(await resolve_actor(tenant_id, x_actor, x_role, request=request), "ingest.jobs.view")
    record = await request.app.state.ingest_jobs.get(tenant_id, job_id)
    if not record:
        raise HTTPException(status_code=404, detail="Ingest job not found")
    return _job_payload(record)