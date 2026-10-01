from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.routes.admin_users import _require_platform_admin
from app.services.artifact_storage import CoreArtifactStorage


router = APIRouter(prefix="/api/admin/storage", tags=["Artifact Storage"])


class StorageSettingsRequest(BaseModel):
    backend: str = "azure_blob"
    local_upload_dir: str | None = Field(default=None, max_length=1024)
    upload_max_bytes: int = Field(default=262144000, ge=1024, le=5368709120)
    blob_prefix: str = Field(default="core-artifacts", max_length=256)
    azure_container: str | None = Field(default=None, max_length=63)
    azure_account_url: str | None = Field(default=None, max_length=1024)
    azure_connection_string: str | None = Field(default=None, max_length=4096)
    azure_account_key: str | None = Field(default=None, max_length=4096)
    azure_sas_token: str | None = Field(default=None, max_length=4096)


def _storage(request: Request) -> CoreArtifactStorage:
    pool = getattr(request.app.state, "database_pool", None)
    if pool is None:
        raise HTTPException(status_code=503, detail="Core database is not configured")
    service = getattr(request.app.state, "artifact_storage", None)
    return service or CoreArtifactStorage(pool)


def _public_settings(settings: dict) -> dict:
    return {
        "backend": settings.get("backend", "local"),
        "local_upload_dir": settings.get("local_upload_dir"),
        "upload_max_bytes": int(settings.get("upload_max_bytes") or 262144000),
        "blob_prefix": settings.get("blob_prefix") or "core-artifacts",
        "azure_container": settings.get("azure_container"),
        "azure_account_url": settings.get("azure_account_url"),
        "has_azure_connection_string": bool(settings.get("has_azure_connection_string")),
        "has_azure_account_key": bool(settings.get("has_azure_account_key")),
        "has_azure_sas_token": bool(settings.get("has_azure_sas_token")),
        "updated_by": settings.get("updated_by"),
        "updated_at": settings.get("updated_at").isoformat() if settings.get("updated_at") else None,
    }


@router.get("")
async def get_storage_settings(request: Request):
    await _require_platform_admin(request)
    settings = await _storage(request).settings()
    return _public_settings(settings)


@router.put("")
async def save_storage_settings(body: StorageSettingsRequest, request: Request):
    actor = await _require_platform_admin(request)
    service = _storage(request)
    pool = request.app.state.database_pool
    backend = body.backend.strip().lower()
    if backend not in {"local", "azure_blob"}:
        raise HTTPException(status_code=400, detail="Storage backend must be local or azure_blob")
    if backend == "azure_blob" and not (body.azure_container or "").strip():
        raise HTTPException(status_code=400, detail="Azure container is required when Azure Blob is selected")

    existing = await pool.fetchrow("SELECT * FROM core_storage_settings WHERE singleton_id = 1")
    existing = dict(existing) if existing else {}
    secret_fields = {
        "azure_connection_string": "azure_connection_string_enc",
        "azure_account_key": "azure_account_key_enc",
        "azure_sas_token": "azure_sas_token_enc",
    }
    encrypted = {}
    for incoming, stored in secret_fields.items():
        value = getattr(body, incoming)
        encrypted[stored] = (
            service.encrypt_secret(value)
            if value and value.strip()
            else existing.get(stored)
        )

    await pool.execute(
        """
        INSERT INTO core_storage_settings
            (singleton_id, backend, local_upload_dir, upload_max_bytes, blob_prefix,
             azure_container, azure_account_url, azure_connection_string_enc,
             azure_account_key_enc, azure_sas_token_enc, updated_by, updated_at)
        VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        ON CONFLICT (singleton_id) DO UPDATE SET
            backend = EXCLUDED.backend,
            local_upload_dir = EXCLUDED.local_upload_dir,
            upload_max_bytes = EXCLUDED.upload_max_bytes,
            blob_prefix = EXCLUDED.blob_prefix,
            azure_container = EXCLUDED.azure_container,
            azure_account_url = EXCLUDED.azure_account_url,
            azure_connection_string_enc = EXCLUDED.azure_connection_string_enc,
            azure_account_key_enc = EXCLUDED.azure_account_key_enc,
            azure_sas_token_enc = EXCLUDED.azure_sas_token_enc,
            updated_by = EXCLUDED.updated_by,
            updated_at = NOW()
        """,
        backend,
        body.local_upload_dir.strip() if body.local_upload_dir else None,
        body.upload_max_bytes,
        body.blob_prefix.strip().strip("/") or "core-artifacts",
        body.azure_container.strip() if body.azure_container else None,
        body.azure_account_url.strip() if body.azure_account_url else None,
        encrypted["azure_connection_string_enc"],
        encrypted["azure_account_key_enc"],
        encrypted["azure_sas_token_enc"],
        actor,
    )
    return {"saved": True, **_public_settings(await service.settings())}


@router.post("/test")
async def test_storage_connection(
    request: Request, body: StorageSettingsRequest | None = None
):
    await _require_platform_admin(request)
    service = _storage(request)
    if body is None:
        return await service.test_connection()

    overrides = body.model_dump()
    current = await service.settings()
    for field in (
        "azure_connection_string",
        "azure_account_key",
        "azure_sas_token",
    ):
        if not overrides[field]:
            overrides[field] = current.get(field)
    return await service.test_connection(overrides)
