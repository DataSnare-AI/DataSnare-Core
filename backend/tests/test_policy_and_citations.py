import pathlib
import sys

from fastapi.testclient import TestClient


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import create_app


def test_restricted_document_is_hidden_from_viewer_but_visible_to_tenant_admin():
    client = TestClient(create_app())
    admin_headers = {"X-Actor": "admin@example.com", "X-Role": "tenant_admin"}

    created = client.post(
        "/api/tenants/7/knowledge/documents",
        headers=admin_headers,
        json={"source_id": "secret-1", "source_type": "incident", "text": "Restricted incident evidence", "classification": "restricted"},
    )
    assert created.status_code == 201

    viewer = client.post(
        "/api/tenants/7/rag/retrieve",
        headers={"X-Actor": "viewer@example.com", "X-Role": "viewer"},
        json={"query": "restricted incident evidence", "top_k": 5},
    )
    assert viewer.status_code == 200
    assert viewer.json()["results"] == []

    privileged = client.post(
        "/api/tenants/7/rag/retrieve",
        headers=admin_headers,
        json={"query": "restricted incident evidence", "top_k": 5},
    )
    assert privileged.status_code == 200
    assert privileged.json()["results"][0]["provenance"]["source_id"] == "secret-1"