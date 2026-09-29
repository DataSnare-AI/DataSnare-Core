from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from app.repositories.ingest_jobs import IngestJobRecord
from app.routes.ingest import SUPPORTED_NATIVE_ARTIFACTS, _job_payload
from app.security.authorization import require_permission, resolve_actor
from app.services.knowledge_ingestion import build_knowledge_item, store_knowledge_item


router = APIRouter(prefix="/api/tenants/{tenant_id}/tools/ainetscope", tags=["AINetScope"])
MAX_CAPTURE_BYTES = 250 * 1024 * 1024


class CaptureJobRequest(BaseModel):
    artifact_name: str = Field(min_length=1)
    artifact_type: str = Field(min_length=1)
    file_size_bytes: int | None = Field(default=None, ge=0)

    @field_validator("artifact_name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return value.strip()

    @field_validator("artifact_type")
    @classmethod
    def normalize_type(cls, value: str) -> str:
        return value.strip().lower().lstrip(".")


@router.post("/jobs")
async def create_capture_job(
    tenant_id: int,
    body: CaptureJobRequest,
    request: Request,
    x_actor: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
):
    actor = require_permission(resolve_actor(tenant_id, x_actor, x_role), "ingest.jobs.create")
    support = SUPPORTED_NATIVE_ARTIFACTS["ainetscope"]
    if body.artifact_type not in support["artifact_types"]:
        raise HTTPException(status_code=400, detail="AINetScope accepts pcap, pcapng, or cap artifacts")
    if body.file_size_bytes is not None and body.file_size_bytes > MAX_CAPTURE_BYTES:
        raise HTTPException(status_code=413, detail="AINetScope staging captures are limited to 250 MiB")
    record = IngestJobRecord(
        tenant_id=tenant_id,
        tool_id="ainetscope",
        artifact_name=body.artifact_name,
        artifact_type=body.artifact_type,
        requested_by=actor.actor_id,
        normalized_schema=support["normalized_schema"],
        native_conversion={
            "schema": "datasnare-ingest/native-conversion-v1",
            "strategy": support["converter"],
            "status": "upload_required",
            "message": "Upload a valid PCAP/PCAPNG artifact to decode packets with the Python parser.",
            "file_size_bytes": body.file_size_bytes,
        },
    )
    saved = await request.app.state.ingest_jobs.create(record)
    return {"schema": "datasnare-ainetscope/job-v1", "job": _job_payload(saved), "next": "upload-artifact"}


@router.get("/jobs/{job_id}")
async def get_capture_job(
    tenant_id: int,
    job_id: str,
    request: Request,
    x_actor: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
):
    require_permission(resolve_actor(tenant_id, x_actor, x_role), "ingest.jobs.view")
    record = await request.app.state.ingest_jobs.get(tenant_id, job_id)
    if not record or record.tool_id != "ainetscope":
        raise HTTPException(status_code=404, detail="AINetScope capture job not found")
    return {"schema": "datasnare-ainetscope/job-v1", "job": _job_payload(record)}


@router.post("/jobs/{job_id}/artifact")
async def upload_capture_artifact(
    tenant_id: int,
    job_id: str,
    request: Request,
    x_actor: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
):
    actor = require_permission(resolve_actor(tenant_id, x_actor, x_role), "ingest.jobs.create")
    record = await request.app.state.ingest_jobs.get(tenant_id, job_id)
    if not record or record.tool_id != "ainetscope":
        raise HTTPException(status_code=404, detail="AINetScope capture job not found")
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_CAPTURE_BYTES:
                raise HTTPException(status_code=413, detail="AINetScope staging captures are limited to 250 MiB")
        except ValueError as error:
            raise HTTPException(status_code=400, detail="Invalid Content-Length header") from error
    data = await request.body()
    if len(data) > MAX_CAPTURE_BYTES:
        raise HTTPException(status_code=413, detail="AINetScope staging captures are limited to 250 MiB")
    await request.app.state.ingest_jobs.update(tenant_id, job_id, state="running")
    try:
        analysis = await request.app.state.capture_parser.analyze(data, record.artifact_name)
        analysis_payload = analysis.__dict__
        knowledge_text = "\n".join(f"{packet.get('timestamp') or ''} {packet.get('severity', '').upper()} {packet.get('summary', '')}" for packet in analysis.preview)
        item = build_knowledge_item(tenant_id, actor.actor_id, item_type="event", source_id=job_id, source_name=record.artifact_name, title=record.artifact_name, text=knowledge_text or analysis.message, agent_id=None, site_id=None, area_id=None, classification="internal", metadata={"tool_id": "ainetscope", "packet_count": analysis.packets, "flow_count": analysis.flows, "host_count": analysis.hosts, "protocols": analysis.protocols, "findings": analysis.findings})
        await store_knowledge_item(request, tenant_id=tenant_id, actor_id=actor.actor_id, item=item)
        completed = await request.app.state.ingest_jobs.update(tenant_id, job_id, state="completed", native_conversion={**(record.native_conversion or {}), "status": "completed", "analysis": analysis_payload, "knowledge_item_id": item.item_id})
        return {"schema": "datasnare-ainetscope/job-result-v1", "job": _job_payload(completed), "analysis": analysis_payload, "knowledge_item_id": item.item_id}
    except ValueError as error:
        failed = await request.app.state.ingest_jobs.update(tenant_id, job_id, state="failed", native_conversion={**(record.native_conversion or {}), "status": "failed", "error": str(error)})
        raise HTTPException(status_code=422, detail=str(error)) from error
