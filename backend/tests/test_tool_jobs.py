import pathlib
import sys

from fastapi.testclient import TestClient


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import create_app


def test_aiperf_and_aiprocmon_web_jobs_are_queued():
    client = TestClient(create_app())
    headers = {"X-Actor": "operator@example.com", "X-Role": "operator"}
    for tool_id, name, artifact_type in [("aiperf", "server.blg", "blg"), ("aiprocmon", "trace.pml", "pml")]:
        response = client.post(f"/api/tenants/7/tools/{tool_id}/jobs", headers=headers, json={"artifact_name": name, "artifact_type": artifact_type})
        assert response.status_code == 200
        assert response.json()["job"]["tool_id"] == tool_id
        assert response.json()["job"]["state"] == "queued"


def test_tool_job_rejects_wrong_artifact_type():
    client = TestClient(create_app())
    response = client.post("/api/tenants/7/tools/aiperf/jobs", headers={"X-Actor": "operator@example.com", "X-Role": "operator"}, json={"artifact_name": "trace.pml", "artifact_type": "pml"})
    assert response.status_code == 400