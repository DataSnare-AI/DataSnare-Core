import pathlib
import sys

from fastapi import FastAPI
from fastapi.testclient import TestClient

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.routes.artifacts import router
from app.security.authorization import ActorContext


class FakeProvider:
    def __init__(self, role):
        self.role = role

    async def resolve_actor(self, tenant_id, *args, **kwargs):
        return ActorContext(actor_id="alice", tenant_id=tenant_id, role=self.role)


class FakePool:
    def __init__(self):
        self.calls = []

    async def fetch(self, query, *args):
        self.calls.append((query, args))
        return [{"artifact_id": "a1", "tenant_id": args[0], "artifact_name": "capture.pcap"}]

    async def fetchrow(self, query, *args):
        self.calls.append((query, args))
        return {"artifact_name": "capture.pcap", "content_type": "application/vnd.tcpdump.pcap", "storage_backend": "local", "storage_ref": "/tmp/capture.pcap"}

    async def execute(self, query, *args):
        self.calls.append((query, args))
        return "DELETE 1"


class FakeStorage:
    def __init__(self):
        self.deleted = []

    async def open_download(self, _artifact):
        return iter([b"capture bytes"])

    async def delete(self, artifact):
        self.deleted.append(artifact)


def build_client(role):
    app = FastAPI()
    app.state.auth_provider = FakeProvider(role)
    app.state.database_pool = FakePool()
    app.state.artifact_storage = FakeStorage()
    app.include_router(router)
    return TestClient(app), app


HEADERS = {"Authorization": "Bearer tenant-session"}


def test_tenant_admin_can_list_own_tenant_artifacts():
    client, _ = build_client("tenant_admin")

    response = client.get("/api/tenants/7/artifacts", headers=HEADERS)

    assert response.status_code == 200
    assert response.json()["artifacts"][0]["artifact_id"] == "a1"


def test_tenant_admin_can_download_tenant_artifact():
    client, _ = build_client("tenant_admin")

    response = client.get("/api/tenants/7/artifacts/a1/download", headers=HEADERS)

    assert response.status_code == 200
    assert response.content == b"capture bytes"
    assert "capture.pcap" in response.headers["content-disposition"]


def test_tenant_admin_can_delete_artifact_and_metadata():
    client, app = build_client("tenant_admin")

    response = client.delete("/api/tenants/7/artifacts/a1", headers=HEADERS)

    assert response.status_code == 200
    assert app.state.artifact_storage.deleted[0]["storage_ref"] == "/tmp/capture.pcap"
    assert any("DELETE FROM core_artifacts" in query for query, _ in app.state.database_pool.calls)


def test_viewer_cannot_delete_artifact():
    client, app = build_client("viewer")

    response = client.delete("/api/tenants/7/artifacts/a1", headers=HEADERS)

    assert response.status_code == 403
    assert app.state.artifact_storage.deleted == []
