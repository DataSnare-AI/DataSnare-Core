import pathlib
import sys

from fastapi.testclient import TestClient


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import create_app


def test_ingest_jobs_require_actor():
    client = TestClient(create_app())

    response = client.get("/api/tenants/7/ingest/jobs")

    assert response.status_code == 401


def test_create_aiperf_blg_ingest_job_contract():
    client = TestClient(create_app())

    response = client.post(
        "/api/tenants/7/ingest/jobs",
        headers={"X-Actor": "operator@example.com"},
        json={"tool_id": "aiperf", "artifact_name": "server01.blg", "artifact_type": ".blg"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["schema"] == "datasnare-ingest/job-v1"
    assert payload["state"] == "queued"
    assert payload["tool_id"] == "aiperf"
    assert payload["artifact_type"] == "blg"
    assert payload["normalized_schema"] == "datasnare-aiperf/events-v1"
    assert payload["native_conversion"]["schema"] == "datasnare-ingest/native-conversion-v1"
    assert payload["native_conversion"]["status"] == "planned"


def test_create_aiprocmon_pml_ingest_job_can_be_fetched_and_listed():
    client = TestClient(create_app())

    created = client.post(
        "/api/tenants/7/ingest/jobs",
        headers={"X-Actor": "operator@example.com"},
        json={"tool_id": "aiprocmon", "artifact_name": "incident.pml", "artifact_type": "pml"},
    )

    assert created.status_code == 200
    job_id = created.json()["job_id"]

    fetched = client.get(f"/api/tenants/7/ingest/jobs/{job_id}", headers={"X-Actor": "operator@example.com"})
    assert fetched.status_code == 200
    assert fetched.json()["normalized_schema"] == "datasnare-aiprocmon/events-v1"

    listed = client.get("/api/tenants/7/ingest/jobs", headers={"X-Actor": "operator@example.com"})
    assert listed.status_code == 200
    assert listed.json()["schema"] == "datasnare-ingest/job-list-v1"
    assert [job["job_id"] for job in listed.json()["jobs"]] == [job_id]


def test_unsupported_ingest_artifact_is_rejected():
    client = TestClient(create_app())

    response = client.post(
        "/api/tenants/7/ingest/jobs",
        headers={"X-Actor": "operator@example.com"},
        json={"tool_id": "airca", "artifact_name": "investigation.json", "artifact_type": "json"},
    )

    assert response.status_code == 400
    assert "Unsupported ingest artifact" in response.json()["detail"]


def test_viewer_can_list_ingest_jobs_but_cannot_create_one():
    client = TestClient(create_app())
    headers = {"X-Actor": "viewer@example.com", "X-Role": "viewer"}

    listed = client.get("/api/tenants/7/ingest/jobs", headers=headers)
    assert listed.status_code == 200

    created = client.post(
        "/api/tenants/7/ingest/jobs",
        headers=headers,
        json={"tool_id": "aiperf", "artifact_name": "server01.blg", "artifact_type": "blg"},
    )
    assert created.status_code == 403
    assert "ingest.jobs.create" in created.json()["detail"]


def test_tenant_admin_can_create_ingest_job():
    client = TestClient(create_app())

    response = client.post(
        "/api/tenants/7/ingest/jobs",
        headers={"X-Actor": "admin@example.com", "X-Role": "tenant_admin"},
        json={"tool_id": "aiperf", "artifact_name": "server01.blg", "artifact_type": "blg"},
    )

    assert response.status_code == 200
    assert response.json()["requested_by"] == "admin@example.com"