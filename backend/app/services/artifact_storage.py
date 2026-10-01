from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
import uuid
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException


logger = logging.getLogger("uvicorn.error")


class CoreArtifactStorage:
    def __init__(self, pool):
        self.pool = pool

    @staticmethod
    def _fernet() -> Fernet:
        key = os.getenv("CORE_STORAGE_ENCRYPTION_KEY", "").strip()
        if not key:
            raise HTTPException(
                status_code=503,
                detail="CORE_STORAGE_ENCRYPTION_KEY is required to store Azure credentials",
            )
        try:
            return Fernet(key.encode())
        except (ValueError, TypeError) as error:
            raise HTTPException(status_code=500, detail="CORE_STORAGE_ENCRYPTION_KEY is invalid") from error

    @classmethod
    def encrypt_secret(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        return cls._fernet().encrypt(value.strip().encode()).decode()

    @classmethod
    def decrypt_secret(cls, value: str | None) -> str | None:
        if not value:
            return None
        try:
            return cls._fernet().decrypt(value.encode()).decode()
        except InvalidToken as error:
            raise HTTPException(status_code=500, detail="Stored Azure credential cannot be decrypted; check CORE_STORAGE_ENCRYPTION_KEY") from error

    async def settings(self) -> dict[str, Any]:
        row = await self.pool.fetchrow(
            "SELECT * FROM core_storage_settings WHERE singleton_id = 1"
        )
        if not row:
            return {
                "backend": "local",
                "local_upload_dir": os.getenv("CORE_ARTIFACT_LOCAL_DIR", "/var/lib/datasnare-core/artifacts"),
                "upload_max_bytes": 262144000,
                "blob_prefix": "core-artifacts",
                "azure_container": None,
                "azure_account_url": None,
                "azure_connection_string": None,
                "azure_account_key": None,
                "azure_sas_token": None,
                "has_azure_connection_string": False,
                "has_azure_account_key": False,
                "has_azure_sas_token": False,
            }
        data = dict(row)
        encrypted_connection = data.pop("azure_connection_string_enc", None)
        encrypted_key = data.pop("azure_account_key_enc", None)
        encrypted_sas = data.pop("azure_sas_token_enc", None)
        return {
            **data,
            "azure_connection_string": self.decrypt_secret(encrypted_connection),
            "azure_account_key": self.decrypt_secret(encrypted_key),
            "azure_sas_token": self.decrypt_secret(encrypted_sas),
            "has_azure_connection_string": bool(encrypted_connection),
            "has_azure_account_key": bool(encrypted_key),
            "has_azure_sas_token": bool(encrypted_sas),
        }

    @staticmethod
    def _safe_name(name: str) -> str:
        leaf = Path(str(name or "artifact.bin")).name
        cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", leaf).strip("._")
        return cleaned[:180] or "artifact.bin"

    @staticmethod
    def _azure_clients(settings: dict[str, Any]):
        try:
            from azure.identity import DefaultAzureCredential
            from azure.storage.blob import BlobServiceClient, ContentSettings
        except ImportError as error:
            raise HTTPException(status_code=503, detail="Azure Blob SDK dependencies are not installed") from error

        connection_string = settings.get("azure_connection_string")
        if connection_string:
            service = BlobServiceClient.from_connection_string(connection_string)
        else:
            account_url = str(settings.get("azure_account_url") or "").strip().rstrip("/")
            if not account_url:
                raise HTTPException(status_code=400, detail="Azure account URL is required")
            credential = settings.get("azure_account_key") or settings.get("azure_sas_token")
            if settings.get("azure_sas_token") and credential == settings.get("azure_sas_token"):
                credential = str(credential).lstrip("?")
                fingerprint = hashlib.sha256(credential.encode()).hexdigest()[:12]
                logger.info(
                    "Azure Blob client selected SAS credential fingerprint=%s length=%d",
                    fingerprint,
                    len(credential),
                )
            if not credential:
                credential = DefaultAzureCredential(exclude_interactive_browser_credential=True)
            service = BlobServiceClient(account_url=account_url, credential=credential)
        return service, ContentSettings

    @staticmethod
    def _safe_probe_error(error: Exception, settings: dict[str, Any]) -> str:
        detail = str(error)
        for field in (
            "azure_connection_string",
            "azure_account_key",
            "azure_sas_token",
        ):
            secret = settings.get(field)
            if secret:
                detail = detail.replace(str(secret), "[redacted]")
        detail = re.sub(
            r"(?i)(https?://[^\s?'\"]+)\?[^\s'\"]+",
            r"\1?[redacted]",
            detail,
        )
        return f"Azure Blob probe failed: {type(error).__name__} · {detail[:600]}"

    async def test_connection(
        self, settings_override: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        settings = await self.settings()
        if settings_override:
            settings.update(settings_override)
        backend = settings["backend"]
        if backend == "local":
            path = Path(settings.get("local_upload_dir") or "/var/lib/datasnare-core/artifacts")
            try:
                await asyncio.to_thread(path.mkdir, parents=True, exist_ok=True)
                writable = await asyncio.to_thread(os.access, path, os.W_OK)
            except OSError as error:
                return {"backend": backend, "healthy": False, "detail": str(error)}
            return {"backend": backend, "healthy": writable, "upload_dir": str(path), "detail": "Local artifact directory is writable" if writable else "Local artifact directory is not writable"}

        container = str(settings.get("azure_container") or "").strip()
        if not container:
            return {"backend": backend, "healthy": False, "detail": "Azure container is required"}
        try:
            service, _ = self._azure_clients(settings)
            client = service.get_container_client(container)
            def probe_list_access():
                first_page = next(
                    iter(client.list_blobs().by_page(results_per_page=1)), None
                )
                if first_page is not None:
                    next(iter(first_page), None)

            await asyncio.to_thread(probe_list_access)
            return {"backend": backend, "healthy": True, "container": container, "blob_prefix": settings.get("blob_prefix"), "detail": "Azure Blob storage is reachable"}
        except HTTPException:
            raise
        except Exception as error:
            return {
                "backend": backend,
                "healthy": False,
                "container": container,
                "detail": self._safe_probe_error(error, settings),
            }

    async def store(
        self,
        *,
        tenant_id: int,
        product_key: str,
        job_id: str | None,
        artifact_name: str,
        content_type: str,
        content: bytes,
        uploaded_by: str,
    ) -> dict[str, Any]:
        settings = await self.settings()
        max_bytes = int(settings.get("upload_max_bytes") or 262144000)
        if len(content) > max_bytes:
            raise HTTPException(status_code=413, detail=f"Artifact exceeds configured upload limit of {max_bytes} bytes")

        artifact_id = str(uuid.uuid4())
        safe_name = self._safe_name(artifact_name)
        blob_prefix = str(settings.get("blob_prefix") or "core-artifacts").strip("/") or "core-artifacts"
        storage_backend = str(settings.get("backend") or "local").strip().lower()
        digest = hashlib.sha256(content).hexdigest()

        if storage_backend in {"azure_blob", "azure", "blob"}:
            container = str(settings.get("azure_container") or "").strip()
            if not container:
                raise HTTPException(status_code=503, detail="Azure container is not configured")
            blob_key = f"{blob_prefix}/tenants/{tenant_id}/{product_key}/{artifact_id}/{safe_name}"
            service, content_settings_type = self._azure_clients(settings)
            blob = service.get_blob_client(container=container, blob=blob_key)
            upload_options = {"overwrite": False}
            if content_settings_type is not None:
                upload_options["content_settings"] = content_settings_type(content_type=content_type or "application/octet-stream")
            try:
                await asyncio.to_thread(blob.upload_blob, content, **upload_options)
            except Exception as error:
                raise HTTPException(status_code=502, detail=f"Azure Blob upload failed ({type(error).__name__})") from error
            storage_ref = f"blob://{container}/{blob_key}"
            storage_backend = "azure_blob"
        elif storage_backend == "local":
            root = Path(settings.get("local_upload_dir") or "/var/lib/datasnare-core/artifacts").resolve()
            relative = Path("tenants") / str(tenant_id) / product_key / artifact_id / safe_name
            destination = (root / relative).resolve()
            if root not in destination.parents:
                raise HTTPException(status_code=400, detail="Invalid artifact path")
            try:
                await asyncio.to_thread(destination.parent.mkdir, parents=True, exist_ok=True)
                await asyncio.to_thread(destination.write_bytes, content)
            except OSError as error:
                raise HTTPException(status_code=507, detail="Local artifact storage failed") from error
            storage_ref = str(destination)
        else:
            raise HTTPException(status_code=400, detail="Unsupported Core artifact storage backend")

        try:
            await self.pool.execute(
                """
                INSERT INTO core_artifacts
                    (artifact_id, tenant_id, product_key, job_id, artifact_name, content_type,
                     size_bytes, sha256, storage_backend, storage_ref, uploaded_by, metadata)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
                """,
                artifact_id, tenant_id, product_key, job_id, safe_name,
                content_type or "application/octet-stream", len(content), digest,
                storage_backend, storage_ref, uploaded_by,
                '{"retention":"unspecified"}',
            )
        except Exception:
            await self._delete_blob_if_present(storage_backend, settings, storage_ref)
            raise

        return {
            "artifact_id": artifact_id,
            "artifact_name": safe_name,
            "content_type": content_type or "application/octet-stream",
            "size_bytes": len(content),
            "sha256": digest,
            "storage_backend": storage_backend,
        }

    async def open_download(self, artifact: dict[str, Any]):
        backend = artifact["storage_backend"]
        reference = str(artifact["storage_ref"])
        if backend == "azure_blob":
            if not reference.startswith("blob://"):
                raise HTTPException(status_code=500, detail="Stored artifact reference is invalid")
            container, separator, blob_name = reference[7:].partition("/")
            if not separator or not container or not blob_name:
                raise HTTPException(status_code=500, detail="Stored artifact reference is invalid")
            service, _ = self._azure_clients(await self.settings())
            blob = service.get_blob_client(container=container, blob=blob_name)
            try:
                downloader = await asyncio.to_thread(blob.download_blob)
            except Exception as error:
                raise HTTPException(status_code=502, detail=f"Azure Blob download failed ({type(error).__name__})") from error
            return downloader.chunks()

        if backend == "local":
            settings = await self.settings()
            root = Path(settings.get("local_upload_dir") or "/var/lib/datasnare-core/artifacts").resolve()
            path = Path(reference).resolve()
            if root not in path.parents or not path.is_file():
                raise HTTPException(status_code=404, detail="Artifact file not found")

            def chunks():
                with path.open("rb") as handle:
                    while data := handle.read(1024 * 1024):
                        yield data

            return chunks()

        raise HTTPException(status_code=500, detail="Stored artifact backend is unsupported")

    async def delete(self, artifact: dict[str, Any]) -> None:
        backend = artifact["storage_backend"]
        reference = str(artifact["storage_ref"])
        if backend == "azure_blob":
            if not reference.startswith("blob://"):
                raise HTTPException(status_code=500, detail="Stored artifact reference is invalid")
            container, separator, blob_name = reference[7:].partition("/")
            if not separator or not container or not blob_name:
                raise HTTPException(status_code=500, detail="Stored artifact reference is invalid")
            service, _ = self._azure_clients(await self.settings())
            blob = service.get_blob_client(container=container, blob=blob_name)
            try:
                await asyncio.to_thread(blob.delete_blob, delete_snapshots="include")
            except Exception as error:
                raise HTTPException(status_code=502, detail=f"Azure Blob delete failed ({type(error).__name__})") from error
            return

        if backend == "local":
            settings = await self.settings()
            root = Path(settings.get("local_upload_dir") or "/var/lib/datasnare-core/artifacts").resolve()
            path = Path(reference).resolve()
            if root not in path.parents:
                raise HTTPException(status_code=400, detail="Artifact path is outside the Core storage directory")
            try:
                await asyncio.to_thread(path.unlink, missing_ok=True)
            except OSError as error:
                raise HTTPException(status_code=500, detail="Could not delete the local artifact") from error
            return

        raise HTTPException(status_code=500, detail="Stored artifact backend is unsupported")

    async def _delete_blob_if_present(self, backend: str, settings: dict[str, Any], storage_ref: str) -> None:
        if backend == "local":
            root = Path(settings.get("local_upload_dir") or "/var/lib/datasnare-core/artifacts").resolve()
            path = Path(storage_ref).resolve()
            if root in path.parents:
                await asyncio.to_thread(path.unlink, missing_ok=True)
            return
        if backend != "azure_blob" or not storage_ref.startswith("blob://"):
            return
        container, _, blob_name = storage_ref[7:].partition("/")
        try:
            service, _ = self._azure_clients(settings)
            blob = service.get_blob_client(container=container, blob=blob_name)
            await asyncio.to_thread(blob.delete_blob, delete_snapshots="include")
        except Exception:
            return
