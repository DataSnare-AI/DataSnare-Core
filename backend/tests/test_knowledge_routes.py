import pathlib
import sys

from fastapi.testclient import TestClient


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import create_app


def test_operator_can_ingest_document_with_provenance_and_list_it():
    client = TestClient(create_app())
    headers = {"X-Actor": "agent@example.com", "X-Role": "operator"}

    created = client.post(
        "/api/tenants/7/knowledge/documents",
        headers=headers,
        json={
            "source_type": "runbook",
            "source_id": "runbook-42",
            "source_name": "Database restart runbook.md",
            "title": "Database restart procedure",
            "text": "Validate the service state before restarting the database.",
            "agent_id": "agent-7",
            "site_id": "site-east",
            "area_id": "area-databases",
        },
    )

    assert created.status_code == 201
    item = created.json()
    assert item["schema"] == "datasnare-knowledge/item-v1"
    assert item["tenant_id"] == 7
    assert item["provenance"]["source_type"] == "runbook"
    assert item["provenance"]["agent_id"] == "agent-7"
    assert item["metadata"]["ingested_by"] == "agent@example.com"

    listed = client.get("/api/tenants/7/knowledge/documents", headers=headers)
    assert listed.status_code == 200
    assert [entry["item_id"] for entry in listed.json()] == [item["item_id"]]

    retrieved = client.post(
        "/api/tenants/7/rag/retrieve",
        headers=headers,
        json={"query": "database restart procedure", "top_k": 3},
    )
    assert retrieved.status_code == 200
    assert retrieved.json()["status"] == "indexed"
    assert retrieved.json()["results"][0]["provenance"]["source_id"] == "runbook-42"

    audit = client.get("/api/tenants/7/rag/audit", headers=headers)
    assert audit.status_code == 200
    assert audit.json()["events"][0]["metadata"]["result_count"] == 1

    other_tenant = client.get("/api/tenants/8/knowledge/documents", headers=headers)
    assert other_tenant.status_code == 200
    assert other_tenant.json() == []


def test_viewer_can_retrieve_documents_but_cannot_ingest_them():
    client = TestClient(create_app())
    headers = {"X-Actor": "viewer@example.com", "X-Role": "viewer"}

    listed = client.get("/api/tenants/7/knowledge/documents", headers=headers)
    assert listed.status_code == 200

    created = client.post(
        "/api/tenants/7/knowledge/documents",
        headers=headers,
        json={"source_id": "notes-1", "text": "Local evidence"},
    )
    assert created.status_code == 403
    assert "rag.ingest" in created.json()["detail"]