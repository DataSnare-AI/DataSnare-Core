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

    uploaded = client.post(f"/api/tenants/7/tools/ailogscope/jobs/{job_id}/artifact", headers=headers, content=b"INFO started\nERROR failed\n")

    assert uploaded.status_code == 200
    assert uploaded.json()["job"]["state"] == "completed"
    assert uploaded.json()["analysis"]["events"] == 2
    assert uploaded.json()["analysis"]["schema"] == "datasnare-ailogscope/events-v1"


def test_ailogscope_rejects_unknown_artifact_type():
    client = TestClient(create_app())
    response = client.post("/api/tenants/7/tools/ailogscope/jobs", headers={"X-Actor": "operator@example.com", "X-Role": "operator"}, json={"artifact_name": "capture.pcap", "artifact_type": "pcap"})
    assert response.status_code == 400
