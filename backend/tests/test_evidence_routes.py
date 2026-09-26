import pathlib
import sys

from fastapi.testclient import TestClient


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import create_app


def test_operator_can_ingest_normalized_aiops_evidence():
    client = TestClient(create_app())

    response = client.post(
        "/api/tenants/7/knowledge/evidence",
        headers={"X-Actor": "aiops-agent@example.com", "X-Role": "operator"},
        json={
            "item_type": "alert",
            "source_id": "alert-42",
            "source_name": "AIOps alert stream",
            "title": "Database latency alert",
            "text": "Database latency exceeded the tenant threshold.",
            "agent_id": "agent-7",
            "site_id": "site-east",
            "area_id": "area-databases",
        },
    )

    assert response.status_code == 201
    assert response.json()["item_type"] == "alert"
    assert response.json()["provenance"]["source_type"] == "alert"


def test_unknown_evidence_type_is_rejected():
    client = TestClient(create_app())

    response = client.post(
        "/api/tenants/7/knowledge/evidence",
        headers={"X-Actor": "operator@example.com", "X-Role": "operator"},
        json={"item_type": "unknown", "source_id": "x", "text": "evidence"},
    )

    assert response.status_code == 422
    assert "Unsupported evidence type" in response.json()["detail"]