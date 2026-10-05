from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Request

from app.repositories.ingest_jobs import IngestJobRecord
from app.routes.ingest import SUPPORTED_NATIVE_ARTIFACTS, _job_payload
from app.security.authorization import require_permission, resolve_actor
from app.services.airca_parser import analyze_rootcause_investigation
from app.services.analysis_plugin_contract import normalized_plugin_evidence_envelope
from app.services.knowledge_ingestion import build_knowledge_item, store_knowledge_item
from app.services.native_analysis_export import EXPORT_SCHEMAS, analyze_native_export


router = APIRouter(prefix="/api/tenants/{tenant_id}/tools", tags=["Tool Jobs"])
ROOTCAUSE_SUPPORT = {
    "artifact_types": {"json"},
    "normalized_schema": "datasnare-rootcause/investigation-v1",
    "converter": "airca-investigation-json-import",
}
SUPPORTED_TOOLS = {"airca", "aiperf", "aiprocmon"}


@router.post("/{tool_id}/jobs")
async def create_tool_job(tenant_id: int, tool_id: str, body: dict, request: Request, x_actor: str | None = Header(default=None), x_role: str | None = Header(default=None)):
    actor = require_permission(await resolve_actor(tenant_id, x_actor, x_role, request=request), "ingest.jobs.create")
    if tool_id not in SUPPORTED_TOOLS:
        raise HTTPException(status_code=404, detail="Tool job route not found")
    artifact_name = str(body.get("artifact_name", "")).strip()
    artifact_type = str(body.get("artifact_type", "")).strip().lower().lstrip(".")
    support = ROOTCAUSE_SUPPORT if tool_id == "airca" else SUPPORTED_NATIVE_ARTIFACTS[tool_id]
    accepted_types = support["artifact_types"] | ({"json"} if tool_id in EXPORT_SCHEMAS else set())
    if not artifact_name or artifact_type not in accepted_types:
        raise HTTPException(status_code=400, detail=f"{tool_id} does not accept this artifact type")
    job_context = {}
    if tool_id == "aiprocmon":
        job_context = {"capture_date": body.get("capture_date"), "timezone_offset": body.get("timezone_offset")}
    conversion_status = "converter_required" if (tool_id, artifact_type) in {("aiperf", "blg"), ("aiprocmon", "pml")} else "upload_required"
    strategy = f"{tool_id}-analysis-json-import" if artifact_type == "json" and tool_id in EXPORT_SCHEMAS else support["converter"]
    record = IngestJobRecord(tenant_id=tenant_id, tool_id=tool_id, artifact_name=artifact_name, artifact_type=artifact_type, requested_by=actor.actor_id, normalized_schema=support["normalized_schema"], native_conversion={"schema": "datasnare-ingest/native-conversion-v1", "strategy": strategy, "status": conversion_status, **job_context})
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
    artifact = None
    storage = getattr(request.app.state, "artifact_storage", None)
    if storage is not None:
        artifact = await storage.store(
            tenant_id=tenant_id, product_key=tool_id, job_id=job_id,
            artifact_name=record.artifact_name,
            content_type=request.headers.get("content-type", "application/octet-stream"),
            content=data, uploaded_by=actor.actor_id,
        )
    conversion = record.native_conversion or {}
    await request.app.state.ingest_jobs.update(tenant_id, job_id, state="running")
    try:
        if tool_id == "airca" or record.artifact_type == "json":
            analysis = analyze_rootcause_investigation(data, record.artifact_name) if tool_id == "airca" else analyze_native_export(data, record.artifact_name, tool_id)
            event_rows = analysis["events"]
            parser_status = "completed"
            normalized = analysis["schema"]
            summary = analysis
            parser_name = analysis["parser"]
        elif tool_id == "aiperf":
            analysis = await request.app.state.aiperf_parser.analyze(data, record.artifact_name)
            event_rows = analysis.events
            parser_status = analysis.status
            normalized = analysis.schema
            summary = {"records": analysis.records, "event_count": len(analysis.events), "events": analysis.events, "parser": analysis.parser, "source_encoding": analysis.source_encoding}
            parser_name = analysis.parser
        else:
            analysis = await request.app.state.aiprocmon_parser.analyze(data, record.artifact_name, conversion.get("capture_date"), conversion.get("timezone_offset"))
            event_rows = analysis.preview
            parser_status = analysis.status
            normalized = analysis.schema
            summary = {"events": analysis.events, "findings": analysis.findings, "preview": analysis.preview, "parser": analysis.parser, "message": analysis.message}
            parser_name = analysis.parser
        knowledge_text = "\n".join(f"{item.get('timestamp') or ''} {item.get('severity', '').upper()} {item.get('summary', '')} {item.get('detail', '')}" for item in event_rows)
        knowledge = build_knowledge_item(tenant_id, actor.actor_id, item_type="metric" if tool_id == "aiperf" else "event", source_id=job_id, source_name=record.artifact_name, title=record.artifact_name, text=knowledge_text or f"{tool_id} parser completed with {summary}", agent_id=None, site_id=None, area_id=None, classification="internal", metadata={"tool_id": tool_id, "normalized_schema": normalized, **summary})
        await store_knowledge_item(request, tenant_id=tenant_id, actor_id=actor.actor_id, item=knowledge)
        evidence = normalized_plugin_evidence_envelope(
            tenant_id=tenant_id,
            plugin_id=tool_id,
            plugin_version="0.1.0",
            job_id=job_id,
            artifact_name=record.artifact_name,
            source_schema=normalized,
            events=event_rows,
            findings=summary.get("findings", []),
            metadata={"parser": parser_name, "status": parser_status, **summary},
        ).model_dump(by_alias=True)
        updated = await request.app.state.ingest_jobs.update(tenant_id, job_id, state="completed", native_conversion={**conversion, "status": parser_status, "analysis": summary, "evidence_envelope": evidence, "knowledge_item_id": knowledge.item_id})
        return {"schema": f"datasnare-{tool_id}/job-result-v1", "job": _job_payload(updated), "analysis": summary, "evidence": evidence, "normalized_schema": normalized, "knowledge_item_id": knowledge.item_id, "artifact": artifact}
    except (ValueError, UnicodeError) as error:
        updated = await request.app.state.ingest_jobs.update(tenant_id, job_id, state="failed", native_conversion={**(record.native_conversion or {}), "status": "failed", "error": str(error)})
        raise HTTPException(status_code=422, detail=str(error)) from error
