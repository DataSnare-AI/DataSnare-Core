from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from app.repositories.ingest_jobs import IngestJobRecord
from app.routes.ingest import SUPPORTED_NATIVE_ARTIFACTS, _job_payload
from app.security.authorization import require_permission, resolve_actor
from app.services.analysis_plugin_contract import normalized_plugin_evidence_envelope
from app.services.ainetscope_export import analyze_ainetscope_export
from app.services.knowledge_ingestion import build_knowledge_item, store_knowledge_item


router = APIRouter(prefix="/api/tenants/{tenant_id}/tools/ainetscope", tags=["AINetScope"])
MAX_CAPTURE_BYTES = 250 * 1024 * 1024
MAX_ANALYSIS_EXPORT_BYTES = 25 * 1024 * 1024
CAPTURE_TYPES = SUPPORTED_NATIVE_ARTIFACTS["ainetscope"]["artifact_types"]
ARTIFACT_TYPES = CAPTURE_TYPES | {"json"}


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
    actor = require_permission(await resolve_actor(tenant_id, x_actor, x_role, request=request), "ingest.jobs.create")
    support = SUPPORTED_NATIVE_ARTIFACTS["ainetscope"]
    if body.artifact_type not in ARTIFACT_TYPES:
        raise HTTPException(status_code=400, detail="AINetScope accepts pcap, pcapng, cap, or analysis JSON exports")
    max_bytes = MAX_ANALYSIS_EXPORT_BYTES if body.artifact_type == "json" else MAX_CAPTURE_BYTES
    if body.file_size_bytes is not None and body.file_size_bytes > max_bytes:
        raise HTTPException(status_code=413, detail=f"AINetScope {body.artifact_type} uploads are limited to {max_bytes // (1024 * 1024)} MiB")
    record = IngestJobRecord(
        tenant_id=tenant_id,
        tool_id="ainetscope",
        artifact_name=body.artifact_name,
        artifact_type=body.artifact_type,
        requested_by=actor.actor_id,
        normalized_schema=support["normalized_schema"],
        native_conversion={
            "schema": "datasnare-ingest/native-conversion-v1",
            "strategy": "ainetscope-analysis-json-import" if body.artifact_type == "json" else support["converter"],
            "status": "upload_required",
            "message": "Upload a valid AINetScope analysis export." if body.artifact_type == "json" else "Upload a valid PCAP/PCAPNG artifact to decode packets with the Python parser.",
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
    require_permission(await resolve_actor(tenant_id, x_actor, x_role, request=request), "ingest.jobs.view")
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
    actor = require_permission(await resolve_actor(tenant_id, x_actor, x_role, request=request), "ingest.jobs.create")
    record = await request.app.state.ingest_jobs.get(tenant_id, job_id)
    if not record or record.tool_id != "ainetscope":
        raise HTTPException(status_code=404, detail="AINetScope capture job not found")
    content_length = request.headers.get("content-length")
    max_bytes = MAX_ANALYSIS_EXPORT_BYTES if record.artifact_type == "json" else MAX_CAPTURE_BYTES
    if content_length:
        try:
            if int(content_length) > max_bytes:
                raise HTTPException(status_code=413, detail=f"AINetScope {record.artifact_type} uploads are limited to {max_bytes // (1024 * 1024)} MiB")
        except ValueError as error:
            raise HTTPException(status_code=400, detail="Invalid Content-Length header") from error
    data = await request.body()
    if len(data) > max_bytes:
        raise HTTPException(status_code=413, detail=f"AINetScope {record.artifact_type} uploads are limited to {max_bytes // (1024 * 1024)} MiB")
    artifact = None
    storage = getattr(request.app.state, "artifact_storage", None)
    if storage is not None:
        artifact = await storage.store(
            tenant_id=tenant_id, product_key="ainetscope", job_id=job_id,
            artifact_name=record.artifact_name,
            content_type=request.headers.get("content-type", "application/octet-stream"),
            content=data, uploaded_by=actor.actor_id,
        )
    await request.app.state.ingest_jobs.update(tenant_id, job_id, state="running")
    try:
        if record.artifact_type == "json":
            analysis_payload = analyze_ainetscope_export(data, record.artifact_name)
            preview = analysis_payload["preview"]
            findings = analysis_payload["findings"]
            source_schema = analysis_payload.get("schema", "datasnare-ainetscope/analysis-v1")
            metadata = {
                key: analysis_payload[key]
                for key in ("packets", "flows", "hosts", "bytes", "service_count", "event_count", "parser", "status")
            }
            message = analysis_payload["message"]
            if analysis_payload.get("analytics"):
                metadata["analytics"] = analysis_payload["analytics"]
        else:
            analysis = await request.app.state.capture_parser.analyze(data, record.artifact_name)
            analysis_payload = analysis.__dict__
            preview = analysis.preview
            findings = analysis.findings
            source_schema = analysis.schema
            metadata = {
                "bytes": analysis.bytes,
                "packets": analysis.packets,
                "flows": analysis.flows,
                "hosts": analysis.hosts,
                "protocols": analysis.protocols,
                "parser": analysis.parser,
                "status": analysis.status,
            }
            message = analysis.message
        evidence = normalized_plugin_evidence_envelope(
            tenant_id=tenant_id,
            plugin_id="ainetscope",
            plugin_version="0.1.0",
            job_id=job_id,
            artifact_name=record.artifact_name,
            source_schema=source_schema,
            events=preview,
            findings=findings,
            metadata=metadata,
        ).model_dump(by_alias=True)
        knowledge_text = "\n".join(f"{packet.get('timestamp') or ''} {packet.get('severity', '').upper()} {packet.get('summary', '')}" for packet in preview)
        item = build_knowledge_item(tenant_id, actor.actor_id, item_type="event", source_id=job_id, source_name=record.artifact_name, title=record.artifact_name, text=knowledge_text or message, agent_id=None, site_id=None, area_id=None, classification="internal", metadata={"tool_id": "ainetscope", **metadata, "findings": findings})
        await store_knowledge_item(request, tenant_id=tenant_id, actor_id=actor.actor_id, item=item)
        completed = await request.app.state.ingest_jobs.update(tenant_id, job_id, state="completed", native_conversion={**(record.native_conversion or {}), "status": "completed", "analysis": analysis_payload, "evidence_envelope": evidence, "knowledge_item_id": item.item_id})
        return {"schema": "datasnare-ainetscope/job-result-v1", "job": _job_payload(completed), "analysis": analysis_payload, "evidence": evidence, "knowledge_item_id": item.item_id, "artifact": artifact}
    except ValueError as error:
        failed = await request.app.state.ingest_jobs.update(tenant_id, job_id, state="failed", native_conversion={**(record.native_conversion or {}), "status": "failed", "error": str(error)})
        raise HTTPException(status_code=422, detail=str(error)) from error
