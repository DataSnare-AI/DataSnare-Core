import pathlib
import sys

from fastapi.testclient import TestClient


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import create_app


def test_rag_retrieve_returns_tenant_scoped_empty_index_contract():
    client = TestClient(create_app())

    response = client.post(
        "/api/tenants/7/rag/retrieve",
        headers={"X-Actor": "operator@example.com", "X-Role": "operator"},
        json={"query": "why did the database service restart?", "top_k": 5},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["schema"] == "datasnare-rag/retrieval-v1"
    assert payload["tenant_id"] == 7
    assert payload["status"] == "not_indexed"
    assert payload["results"] == []
    assert payload["audit_event"]["event_type"] == "rag.retrieve"
    assert payload["audit_event"]["actor_id"] == "operator@example.com"


def test_rag_retrieve_requires_retrieval_permission():
    client = TestClient(create_app())

    response = client.post(
        "/api/tenants/7/rag/retrieve",
        headers={"X-Actor": "unknown@example.com", "X-Role": "unsupported"},
        json={"query": "find related alerts"},
    )

    assert response.status_code == 403