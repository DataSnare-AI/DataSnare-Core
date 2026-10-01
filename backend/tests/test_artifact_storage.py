import asyncio
import hashlib
import pathlib
import sys

import pytest
from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.routes.admin_storage import router
from app.services.artifact_storage import CoreArtifactStorage


class FakePool:
    def __init__(self):
        self.settings_row = None
        self.execute_calls = []

    async def fetchrow(self, query, *args):
        if "core_storage_settings" in query:
            return self.settings_row
        return None

    async def execute(self, query, *args):
        self.execute_calls.append((query, args))
        if "INSERT INTO core_storage_settings" in query:
            self.settings_row = {
                "backend": args[0],
                "local_upload_dir": args[1],
                "upload_max_bytes": args[2],
                "blob_prefix": args[3],
                "azure_container": args[4],
                "azure_account_url": args[5],
                "azure_connection_string_enc": args[6],
                "azure_account_key_enc": args[7],
                "azure_sas_token_enc": args[8],
                "updated_by": args[9],
                "updated_at": None,
            }


class FakeProvider:
    def __init__(self, role="platform_admin"):
        self.role = role

    async def profile(self, authorization):
        return {"username": "admin", "actor_id": "admin", "role": self.role}


def test_core_storage_admin_encrypts_secrets_and_never_returns_them(monkeypatch):
    encryption_key = Fernet.generate_key().decode()
    monkeypatch.setenv("CORE_STORAGE_ENCRYPTION_KEY", encryption_key)
    pool = FakePool()
    app = FastAPI()
    app.state.database_pool = pool
    app.state.artifact_storage = CoreArtifactStorage(pool)
    app.state.auth_provider = FakeProvider()
    app.include_router(router)
    client = TestClient(app)

    response = client.put(
        "/api/admin/storage",
        headers={"Authorization": "Bearer session"},
        json={
            "backend": "azure_blob",
            "azure_container": "shared-docs",
            "azure_account_url": "https://storage.example.test",
            "azure_account_key": "account-secret-value",
            "blob_prefix": "core-artifacts",
        },
    )

    assert response.status_code == 200
    assert response.json()["has_azure_account_key"] is True
    assert "azure_account_key" not in response.json()
    stored_secret = pool.settings_row["azure_account_key_enc"]
    assert stored_secret != "account-secret-value"
    assert Fernet(encryption_key.encode()).decrypt(stored_secret.encode()).decode() == "account-secret-value"


def test_saving_sas_replaces_other_saved_credentials(monkeypatch):
    encryption_key = Fernet.generate_key().decode()
    monkeypatch.setenv("CORE_STORAGE_ENCRYPTION_KEY", encryption_key)
    pool = FakePool()
    pool.settings_row = {
        "backend": "azure_blob",
        "azure_connection_string_enc": CoreArtifactStorage.encrypt_secret("stale-connection"),
        "azure_account_key_enc": CoreArtifactStorage.encrypt_secret("stale-account-key"),
        "azure_sas_token_enc": None,
    }
    app = FastAPI()
    app.state.database_pool = pool
    app.state.artifact_storage = CoreArtifactStorage(pool)
    app.state.auth_provider = FakeProvider()
    app.include_router(router)

    response = TestClient(app).put(
        "/api/admin/storage",
        headers={"Authorization": "Bearer session"},
        json={
            "backend": "azure_blob",
            "azure_container": "shared-docs",
            "azure_account_url": "https://storage.example.test",
            "azure_sas_token": "sv=version&sig=new-signature",
        },
    )

    assert response.status_code == 200
    assert pool.settings_row["azure_connection_string_enc"] is None
    assert pool.settings_row["azure_account_key_enc"] is None
    assert CoreArtifactStorage.decrypt_secret(pool.settings_row["azure_sas_token_enc"]) == "sv=version&sig=new-signature"


def test_storage_admin_rejects_multiple_new_credentials(monkeypatch):
    monkeypatch.setenv("CORE_STORAGE_ENCRYPTION_KEY", Fernet.generate_key().decode())
    pool = FakePool()
    app = FastAPI()
    app.state.database_pool = pool
    app.state.artifact_storage = CoreArtifactStorage(pool)
    app.state.auth_provider = FakeProvider()
    app.include_router(router)

    response = TestClient(app).put(
        "/api/admin/storage",
        headers={"Authorization": "Bearer session"},
        json={
            "backend": "azure_blob",
            "azure_container": "shared-docs",
            "azure_account_key": "account-key",
            "azure_sas_token": "sv=version&sig=token",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"].startswith("Provide only one Azure credential")


def test_only_platform_admin_can_view_shared_storage_configuration():
    pool = FakePool()
    app = FastAPI()
    app.state.database_pool = pool
    app.state.artifact_storage = CoreArtifactStorage(pool)
    app.state.auth_provider = FakeProvider(role="tenant_admin")
    app.include_router(router)

    response = TestClient(app).get("/api/admin/storage", headers={"Authorization": "Bearer session"})

    assert response.status_code == 403


def test_local_artifact_storage_is_tenant_product_scoped_and_records_checksum(tmp_path, monkeypatch):
    monkeypatch.setenv("CORE_ARTIFACT_LOCAL_DIR", str(tmp_path))
    pool = FakePool()
    service = CoreArtifactStorage(pool)
    content = b"original source evidence"

    result = asyncio.run(service.store(
        tenant_id=41,
        product_key="ailogscope",
        job_id="job-abc",
        artifact_name="../service log.txt",
        content_type="text/plain",
        content=content,
        uploaded_by="alice",
    ))

    assert result["sha256"] == hashlib.sha256(content).hexdigest()
    assert result["artifact_name"] == "service_log.txt"
    assert result["storage_backend"] == "local"
    insert = next(args for query, args in pool.execute_calls if "INSERT INTO core_artifacts" in query)
    assert insert[1:4] == (41, "ailogscope", "job-abc")
    assert insert[7] == result["sha256"]
    assert "/tenants/41/ailogscope/" in insert[9].replace("\\", "/")
    assert pathlib.Path(insert[9]).read_bytes() == content


def test_storage_limit_is_enforced_before_file_write(tmp_path, monkeypatch):
    monkeypatch.setenv("CORE_ARTIFACT_LOCAL_DIR", str(tmp_path))
    pool = FakePool()
    pool.settings_row = {
        "backend": "local", "local_upload_dir": str(tmp_path), "upload_max_bytes": 3,
        "blob_prefix": "core-artifacts",
    }
    service = CoreArtifactStorage(pool)

    with pytest.raises(Exception) as error:
        asyncio.run(service.store(
            tenant_id=2, product_key="aiperf", job_id=None, artifact_name="big.csv",
            content_type="text/csv", content=b"four", uploaded_by="alice",
        ))

    assert getattr(error.value, "status_code", None) == 413
    assert not pool.execute_calls


def test_storage_health_reports_writable_local_directory(tmp_path, monkeypatch):
    monkeypatch.setenv("CORE_ARTIFACT_LOCAL_DIR", str(tmp_path / "artifacts"))
    result = asyncio.run(CoreArtifactStorage(FakePool()).test_connection())

    assert result["backend"] == "local"
    assert result["healthy"] is True
    assert (tmp_path / "artifacts").is_dir()


def test_storage_test_uses_unsaved_backend_and_retains_blank_saved_secret(monkeypatch):
    encryption_key = Fernet.generate_key().decode()
    monkeypatch.setenv("CORE_STORAGE_ENCRYPTION_KEY", encryption_key)
    pool = FakePool()
    service = CoreArtifactStorage(pool)
    encrypted_key = service.encrypt_secret("stored-account-key")
    pool.settings_row = {
        "backend": "local",
        "local_upload_dir": "/tmp/artifacts",
        "upload_max_bytes": 262144000,
        "blob_prefix": "core-artifacts",
        "azure_container": "old-container",
        "azure_account_url": "https://storage.example.test",
        "azure_connection_string_enc": None,
        "azure_account_key_enc": encrypted_key,
        "azure_sas_token_enc": None,
    }
    app = FastAPI()
    app.state.database_pool = pool
    app.state.artifact_storage = service
    app.state.auth_provider = FakeProvider()
    app.include_router(router)
    received_settings = {}

    async def capture_test_connection(settings_override=None):
        received_settings.update(settings_override or {})
        return {"backend": received_settings["backend"], "healthy": True, "detail": "probe ok"}

    service.test_connection = capture_test_connection
    response = TestClient(app).post(
        "/api/admin/storage/test",
        headers={"Authorization": "Bearer session"},
        json={
            "backend": "azure_blob",
            "azure_container": "new-container",
            "azure_account_url": "https://storage.example.test",
            "azure_account_key": "",
            "blob_prefix": "core-artifacts",
        },
    )

    assert response.status_code == 200
    assert response.json()["backend"] == "azure_blob"
    assert received_settings["azure_container"] == "new-container"
    assert received_settings["azure_account_key"] == "stored-account-key"
    assert pool.settings_row["backend"] == "local"


def test_azure_probe_error_includes_safe_diagnostic_without_credentials(monkeypatch):
    sas_token = "sv=version&sig=secret-signature"

    class FailingContainer:
        def exists(self):
            raise ValueError(
                f"Invalid SAS token in https://storage.example.test/?{sas_token}; ErrorCode:AuthenticationFailed"
            )

    class FakeBlobService:
        def get_container_client(self, container):
            return FailingContainer()

    monkeypatch.setattr(
        CoreArtifactStorage,
        "_azure_clients",
        staticmethod(lambda settings: (FakeBlobService(), None)),
    )
    service = CoreArtifactStorage(FakePool())

    result = asyncio.run(service.test_connection({
        "backend": "azure_blob",
        "azure_container": "artifacts",
        "azure_sas_token": sas_token,
    }))

    assert result["healthy"] is False
    assert "Invalid SAS token" in result["detail"]
    assert "ValueError" in result["detail"]
    assert "ErrorCode:AuthenticationFailed" in result["detail"]
    assert sas_token not in result["detail"]
    assert "[redacted]" in result["detail"]


def test_azure_client_logs_sas_fingerprint_without_token(caplog):
    sas_token = "?sv=version&si=policy&sig=secret-signature"
    expected_fingerprint = hashlib.sha256(sas_token.lstrip("?").encode()).hexdigest()[:12]
    service = CoreArtifactStorage(FakePool())

    with caplog.at_level("INFO", logger="app.services.artifact_storage"):
        service._azure_clients({
            "azure_account_url": "https://storage.example.test",
            "azure_sas_token": sas_token,
        })

    assert expected_fingerprint in caplog.text
    assert "length=" in caplog.text
    assert sas_token not in caplog.text
    assert "secret-signature" not in caplog.text
