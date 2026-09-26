import pathlib
import sys

from fastapi.testclient import TestClient


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import create_app


def test_tenant_admin_can_add_graph_edge_and_viewer_can_read_it():
    client = TestClient(create_app())

    created = client.post(
        "/api/tenants/7/knowledge/graph/edges",
        headers={"X-Actor": "admin@example.com", "X-Role": "tenant_admin"},
        json={
            "subject_type": "alert",
            "subject_id": "alert-42",
            "predicate": "caused_by",
            "object_type": "service",
            "object_id": "database",
        },
    )

    assert created.status_code == 201
    edge = created.json()
    assert edge["schema"] == "datasnare-knowledge/edge-v1"
    assert edge["tenant_id"] == 7
    assert edge["metadata"]["created_by"] == "admin@example.com"

    listed = client.get(
        "/api/tenants/7/knowledge/graph/edges",
        headers={"X-Actor": "viewer@example.com", "X-Role": "viewer"},
    )
    assert listed.status_code == 200
    assert listed.json()[0]["predicate"] == "caused_by"

    other_tenant = client.get(
        "/api/tenants/8/knowledge/graph/edges",
        headers={"X-Actor": "viewer@example.com", "X-Role": "viewer"},
    )
    assert other_tenant.json() == []


def test_operator_cannot_mutate_knowledge_graph():
    client = TestClient(create_app())

    response = client.post(
        "/api/tenants/7/knowledge/graph/edges",
        headers={"X-Actor": "operator@example.com", "X-Role": "operator"},
        json={
            "subject_type": "document",
            "subject_id": "doc-1",
            "predicate": "mentions",
            "object_type": "device",
            "object_id": "device-1",
        },
    )

    assert response.status_code == 403
    assert "rag.graph.manage" in response.json()["detail"]