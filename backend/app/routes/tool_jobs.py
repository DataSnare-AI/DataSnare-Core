from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Request

from app.repositories.ingest_jobs import IngestJobRecord
from app.routes.ingest import SUPPORTED_NATIVE_ARTIFACTS, _job_payload
from app.security.authorization import require_permission, resolve_actor
from app.services.knowledge_ingestion import build_knowledge_item, store_knowledge_item


router = APIRouter(prefix="/api/tenants/{tenant_id}/tools", tags=["Tool Jobs"])
SUPPORTED_TOOLS = {"aiperf", "aiprocmon"}


@router.post("/{tool_id}/jobs")
async def create_tool_job(tenant_id: int, tool_id: str, body: dict, request: Request, x_actor: str | None = Header(default=None), x_role: str | None = Header(default=None)):
    actor = require_permission(await resolve_actor(tenant_id, x_actor, x_role, request=request), "ingest.jobs.create")
    if tool_id not in SUPPORTED_TOOLS:
        raise HTTPException(status_code=404, detail="Tool job route not found")
    artifact_name = str(body.get("artifact_name", "")).strip()
    artifact_type = str(body.get("artifact_type", "")).strip().lower().lstrip(".")
    support = SUPPORTED_NATIVE_ARTIFACTS[tool_id]
    if not artifact_name or artifact_type not in support["artifact_types"]:
        raise HTTPException(status_code=400, detail=f"{tool_id} does not accept this artifact type")
    job_context = {}
    if tool_id == "aiprocmon":
        job_context = {"capture_date": body.get("capture_date"), "timezone_offset": body.get("timezone_offset")}
    conversion_status = "converter_required" if (tool_id, artifact_type) in {("aiperf", "blg"), ("aiprocmon", "pml")} else "upload_required"
    record = IngestJobRecord(tenant_id=tenant_id, tool_id=tool_id, artifact_name=artifact_name, artifact_type=artifact_type, requested_by=actor.actor_id, normalized_schema=support["normalized_schema"], native_conversion={"schema": "datasnare-ingest/native-conversion-v1", "strategy": support["converter"], "status": conversion_status, **job_context})
    saved = await request.app.state.ingest_jobs.create(record)
    return {"schema": f"datasnare-{tool_id}/job-v1", "job": _job_payload(saved), "next": "upload-artifact"}


@router.get("/{tool_id}/jobs/{job_id}")
async def get_tool_job(tenant_id: int, tool_id: str, job_id: str, request: Request, x_actor: str | None = Header(default=None), x_role: str | None = Header(default=None)):
    require_permission(await resolve_actor(tenant_id, x_actor, x_role, request=request), "ingest.jobs.view")
    if tool_id not in SUPPORTED_TOOLS:
        raise HTTPException(status_code=404, detail="Tool job route not found")
    record = await request.app.state.ingest_jobs.get(tenant_id, job_id)
    if not record or record.tool_id != tool_id:
        raise HTTPException(status_code=404, detail="Tool job not found")
    return {"schema": f"datasnare-{tool_id}/job-v1", "job": _job_payload(record)}


@router.post("/{tool_id}/jobs/{job_id}/artifact")
async def upload_tool_artifact(tenant_id: int, tool_id: str, job_id: str, request: Request, x_actor: str | None = Header(default=None), x_role: str | None = Header(default=None)):
    actor = require_permission(await resolve_actor(tenant_id, x_actor, x_role, request=request), "ingest.jobs.create")
    if tool_id not in SUPPORTED_TOOLS:
        raise HTTPException(status_code=404, detail="Tool job route not found")
    record = await request.app.state.ingest_jobs.get(tenant_id, job_id)
    if not record or record.tool_id != tool_id:
        raise HTTPException(status_code=404, detail="Tool job not found")
    if record.artifact_type in {"blg", "pml"}:
        raise HTTPException(status_code=422, detail=f"Native .{record.artifact_type} requires its supported Windows converter; upload the converted CSV/XML instead")
    content_length = request.headers.get("content-length")
    try:
        declared_size = int(content_length) if content_length else None
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Invalid Content-Length header") from error
    if declared_size is not None and declared_size > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Tool uploads are limited to 25 MiB")
    data = await request.body()
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Tool uploads are limited to 25 MiB")
    conversion = record.native_conversion or {}
    await request.app.state.ingest_jobs.update(tenant_id, job_id, state="running")
    try:
        if tool_id == "aiperf":
            analysis = await request.app.state.aiperf_parser.analyze(data, record.artifact_name)
            event_rows = analysis.events
            parser_status = analysis.status
            normalized = analysis.schema
            summary = {"records": analysis.records, "event_count": len(analysis.events), "events": analysis.events, "parser": analysis.parser, "source_encoding": analysis.source_encoding}
        else:
            analysis = await request.app.state.aiprocmon_parser.analyze(data, record.artifact_name, conversion.get("capture_date"), conversion.get("timezone_offset"))
            event_rows = analysis.preview
            parser_status = analysis.status
            normalized = analysis.schema
            summary = {"events": analysis.events, "findings": analysis.findings, "preview": analysis.preview, "parser": analysis.parser, "message": analysis.message}
        knowledge_text = "\n".join(f"{item.get('timestamp') or ''} {item.get('severity', '').upper()} {item.get('summary', '')} {item.get('detail', '')}" for item in event_rows)
        knowledge = build_knowledge_item(tenant_id, actor.actor_id, item_type="metric" if tool_id == "aiperf" else "event", source_id=job_id, source_name=record.artifact_name, title=record.artifact_name, text=knowledge_text or f"{tool_id} parser completed with {summary}", agent_id=None, site_id=None, area_id=None, classification="internal", metadata={"tool_id": tool_id, "normalized_schema": normalized, **summary})
        await store_knowledge_item(request, tenant_id=tenant_id, actor_id=actor.actor_id, item=knowledge)
        updated = await request.app.state.ingest_jobs.update(tenant_id, job_id, state="completed", native_conversion={**conversion, "status": parser_status, "analysis": summary, "knowledge_item_id": knowledge.item_id})
        return {"schema": f"datasnare-{tool_id}/job-result-v1", "job": _job_payload(updated), "analysis": summary, "normalized_schema": normalized, "knowledge_item_id": knowledge.item_id}
    except (ValueError, UnicodeError) as error:
        updated = await request.app.state.ingest_jobs.update(tenant_id, job_id, state="failed", native_conversion={**(record.native_conversion or {}), "status": "failed", "error": str(error)})
        raise HTTPException(status_code=422, detail=str(error)) from error
