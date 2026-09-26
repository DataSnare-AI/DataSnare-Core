from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Request

from app.repositories.ingest_jobs import IngestJobRecord
from app.routes.ingest import SUPPORTED_NATIVE_ARTIFACTS, _job_payload
from app.security.authorization import require_permission, resolve_actor


router = APIRouter(prefix="/api/tenants/{tenant_id}/tools", tags=["Tool Jobs"])
SUPPORTED_TOOLS = {"aiperf", "aiprocmon"}


@router.post("/{tool_id}/jobs")
async def create_tool_job(tenant_id: int, tool_id: str, body: dict, request: Request, x_actor: str | None = Header(default=None), x_role: str | None = Header(default=None)):
    actor = require_permission(resolve_actor(tenant_id, x_actor, x_role), "ingest.jobs.create")
    if tool_id not in SUPPORTED_TOOLS:
        raise HTTPException(status_code=404, detail="Tool job route not found")
    artifact_name = str(body.get("artifact_name", "")).strip()
    artifact_type = str(body.get("artifact_type", "")).strip().lower().lstrip(".")
    support = SUPPORTED_NATIVE_ARTIFACTS[tool_id]
    if not artifact_name or artifact_type not in support["artifact_types"]:
        raise HTTPException(status_code=400, detail=f"{tool_id} does not accept this artifact type")
    record = IngestJobRecord(tenant_id=tenant_id, tool_id=tool_id, artifact_name=artifact_name, artifact_type=artifact_type, requested_by=actor.actor_id, normalized_schema=support["normalized_schema"], native_conversion={"schema": "datasnare-ingest/native-conversion-v1", "strategy": support["converter"], "status": "planned"})
    saved = await request.app.state.ingest_jobs.create(record)
    return {"schema": f"datasnare-{tool_id}/job-v1", "job": _job_payload(saved), "next": "upload-artifact"}
