from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.security.authorization import require_permission, resolve_actor


router = APIRouter(prefix="/api/tenants/{tenant_id}/artifacts", tags=["Artifacts"])


@router.get("")
async def list_artifacts(
    tenant_id: int,
    request: Request,
    x_actor: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
):
    actor = await resolve_actor(tenant_id, x_actor, x_role, request=request)
    require_permission(actor, "rag.retrieve")
    pool = request.app.state.database_pool
    if pool is None:
        return {"schema": "datasnare-core/artifact-list-v1", "tenant_id": tenant_id, "artifacts": []}
    rows = await pool.fetch(
        """
        SELECT artifact_id, tenant_id, product_key, job_id, artifact_name, content_type,
               size_bytes, sha256, storage_backend, uploaded_by, retention_until, created_at
        FROM core_artifacts
        WHERE tenant_id = $1
        ORDER BY created_at DESC
        LIMIT 500
        """,
        tenant_id,
    )
    return {
        "schema": "datasnare-core/artifact-list-v1",
        "tenant_id": tenant_id,
        "artifacts": [
            {key: value.isoformat() if hasattr(value, "isoformat") else value for key, value in dict(row).items()}
            for row in rows
        ],
    }


@router.get("/{artifact_id}/download")
async def download_artifact(
    tenant_id: int,
    artifact_id: str,
    request: Request,
    x_actor: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
):
    actor = await resolve_actor(tenant_id, x_actor, x_role, request=request)
    require_permission(actor, "ingest.jobs.view")
    pool = request.app.state.database_pool
    if pool is None:
        raise HTTPException(status_code=404, detail="Artifact not found")
    row = await pool.fetchrow(
        """
        SELECT artifact_name, content_type, storage_backend, storage_ref
        FROM core_artifacts
        WHERE tenant_id = $1 AND artifact_id = $2
        """,
        tenant_id,
        artifact_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Artifact not found")
    storage = request.app.state.artifact_storage
    if storage is None:
        raise HTTPException(status_code=503, detail="Artifact storage is not configured")
    stream = await storage.open_download(dict(row))
    filename = str(row["artifact_name"]).replace('"', "")
    return StreamingResponse(
        stream,
        media_type=row["content_type"],
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("/{artifact_id}")
async def delete_artifact(
    tenant_id: int,
    artifact_id: str,
    request: Request,
    x_actor: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
):
    actor = await resolve_actor(tenant_id, x_actor, x_role, request=request)
    require_permission(actor, "artifacts.manage")
    pool = request.app.state.database_pool
    if pool is None:
        raise HTTPException(status_code=404, detail="Artifact not found")
    row = await pool.fetchrow(
        "SELECT storage_backend, storage_ref FROM core_artifacts WHERE tenant_id = $1 AND artifact_id = $2",
        tenant_id,
        artifact_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Artifact not found")
    storage = request.app.state.artifact_storage
    if storage is None:
        raise HTTPException(status_code=503, detail="Artifact storage is not configured")
    await storage.delete(dict(row))
    await pool.execute(
        "DELETE FROM core_artifacts WHERE tenant_id = $1 AND artifact_id = $2",
        tenant_id,
        artifact_id,
    )
    return {"status": "deleted", "artifact_id": artifact_id, "tenant_id": tenant_id}
