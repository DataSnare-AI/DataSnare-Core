import pathlib
import sys

from fastapi.testclient import TestClient


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import create_app


def test_tenant_admin_can_register_manifest_and_viewer_can_list_it():
    client = TestClient(create_app())

    registered = client.put(
        "/api/tenants/7/rag/agents/agent-7/manifest",
        headers={"X-Actor": "admin@example.com", "X-Role": "tenant_admin"},
        json={
            "agent_id": "ignored-body-id",
            "system_name": "server-07",
            "site_id": "site-east",
            "area_id": "area-databases",
            "capabilities": ["telemetry", "document-ingest"],
            "knowledge_types": ["alerts", "runbooks"],
            "status": "online",
        },
    )

    assert registered.status_code == 200
    manifest = registered.json()
    assert manifest["schema"] == "datasnare-rag/agent-manifest-v1"
    assert manifest["agent_id"] == "agent-7"
    assert manifest["metadata"]["updated_by"] == "admin@example.com"

    listed = client.get(
        "/api/tenants/7/rag/agents",
        headers={"X-Actor": "viewer@example.com", "X-Role": "viewer"},
    )
    assert listed.status_code == 200
    assert listed.json()[0]["site_id"] == "site-east"

    other_tenant = client.get(
        "/api/tenants/8/rag/agents",
        headers={"X-Actor": "viewer@example.com", "X-Role": "viewer"},
    )
    assert other_tenant.json() == []


def test_operator_cannot_manage_agent_manifest():
    client = TestClient(create_app())

    response = client.put(
        "/api/tenants/7/rag/agents/agent-7/manifest",
        headers={"X-Actor": "operator@example.com", "X-Role": "operator"},
        json={"agent_id": "agent-7", "system_name": "server-07"},
    )

    assert response.status_code == 403
    assert "rag.manifest.manage" in response.json()["detail"]