import pathlib
import sys

from fastapi.testclient import TestClient


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import create_app


def test_ailogscope_upload_normalizes_utf8_events():
    client = TestClient(create_app())
    headers = {"X-Actor": "operator@example.com", "X-Role": "operator"}
    created = client.post("/api/tenants/7/tools/ailogscope/jobs", headers=headers, json={"artifact_name": "application.log", "artifact_type": "log"})
    job_id = created.json()["job"]["job_id"]

    uploaded = client.post(f"/api/tenants/7/tools/ailogscope/jobs/{job_id}/artifact", headers=headers, content=b"2026-09-28T10:00:00Z INFO started\n2026-09-28T10:00:02Z ERROR failed\n")

    assert uploaded.status_code == 200
    assert uploaded.json()["job"]["state"] == "completed"
    assert uploaded.json()["analysis"]["events"] == 2
    assert uploaded.json()["analysis"]["schema"] == "datasnare-ailogscope/events-v1"
    assert uploaded.json()["analysis"]["preview"][0]["timestamp"] == "2026-09-28T10:00:00Z"
    assert uploaded.json()["analysis"]["preview"][1]["severity"] == "error"
    assert uploaded.json()["analysis"]["preview"][1]["evidence"]["sourceLine"] == 2
    assert uploaded.json()["analysis"]["severity_counts"] == {"info": 1, "error": 1}
    assert uploaded.json()["knowledge_item_id"]
    assert uploaded.json()["evidence"]["schema"] == "datasnare-analysis-evidence/v1"
    assert uploaded.json()["evidence"]["plugin_id"] == "ailogscope"
    assert uploaded.json()["evidence"]["tenant_id"] == 7
    assert uploaded.json()["evidence"]["events"][0]["summary"]

    status = client.get(
        f"/api/tenants/7/tools/ailogscope/jobs/{job_id}", headers=headers
    )
    assert status.status_code == 200
    assert status.json()["job"]["state"] == "completed"
    assert status.json()["analysis"]["events"] == 2
    assert status.json()["evidence"]["plugin_id"] == "ailogscope"
    assert status.json()["knowledge_item_id"] == uploaded.json()["knowledge_item_id"]

    retrieved = client.post("/api/tenants/7/rag/retrieve", headers=headers, json={"query": "database timeout", "top_k": 3})
    assert retrieved.status_code == 200
    assert any(result["provenance"]["source_id"] == job_id for result in retrieved.json()["results"])


def test_ailogscope_job_status_is_tenant_scoped_and_tool_scoped():
    client = TestClient(create_app())
    headers = {"X-Actor": "operator@example.com", "X-Role": "operator"}
    created = client.post(
        "/api/tenants/7/tools/ailogscope/jobs",
        headers=headers,
        json={"artifact_name": "application.log", "artifact_type": "log"},
    )
    job_id = created.json()["job"]["job_id"]

    other_tenant = client.get(
        f"/api/tenants/8/tools/ailogscope/jobs/{job_id}", headers=headers
    )
    missing = client.get(
        "/api/tenants/7/tools/ailogscope/jobs/not-a-job", headers=headers
    )

    assert other_tenant.status_code == 404
    assert missing.status_code == 404


def test_ailogscope_rejects_unknown_artifact_type():
    client = TestClient(create_app())
    response = client.post("/api/tenants/7/tools/ailogscope/jobs", headers={"X-Actor": "operator@example.com", "X-Role": "operator"}, json={"artifact_name": "capture.pcap", "artifact_type": "pcap"})
    assert response.status_code == 400


def test_ailogscope_rejects_oversized_upload_before_running_job():
    client = TestClient(create_app())
    headers = {"X-Actor": "operator@example.com", "X-Role": "operator"}
    created = client.post("/api/tenants/7/tools/ailogscope/jobs", headers=headers, json={"artifact_name": "large.log", "artifact_type": "log"})
    job_id = created.json()["job"]["job_id"]

    uploaded = client.post(
        f"/api/tenants/7/tools/ailogscope/jobs/{job_id}/artifact",
        headers={**headers, "Content-Length": str(26 * 1024 * 1024)},
        content=b"x",
    )

    assert uploaded.status_code == 413
    status = client.get(f"/api/tenants/7/ingest/jobs/{job_id}", headers=headers)
    assert status.json()["state"] == "queued"


def test_ailogscope_json_and_yaml_records_are_normalized():
    client = TestClient(create_app())
    headers = {"X-Actor": "operator@example.com", "X-Role": "operator"}
    cases = [
        ("events.json", "json", b'{"events":[{"timestamp":"2026-09-28T10:00:00Z","level":"Warning","host":"APP01","message":"connection retry"}]}'),
        ("events.yaml", "yaml", b"events:\n  - timestamp: 2026-09-28T10:00:00Z\n    level: Critical\n    message: service failed\n"),
    ]
    for name, artifact_type, content in cases:
        created = client.post("/api/tenants/7/tools/ailogscope/jobs", headers=headers, json={"artifact_name": name, "artifact_type": artifact_type})
        job_id = created.json()["job"]["job_id"]
        uploaded = client.post(f"/api/tenants/7/tools/ailogscope/jobs/{job_id}/artifact", headers=headers, content=content)
        assert uploaded.status_code == 200
        analysis = uploaded.json()["analysis"]
        assert analysis["events"] == 1
        assert analysis["preview"][0]["timestamp"] == "2026-09-28T10:00:00Z"
        assert analysis["parser"].startswith("ailogscope-")
