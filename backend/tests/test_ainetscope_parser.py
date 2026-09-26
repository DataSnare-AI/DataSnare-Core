import pathlib
import sys

from fastapi.testclient import TestClient


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import create_app


def test_ainetscope_upload_accepts_pcapng_and_completes_job():
    client = TestClient(create_app())
    headers = {"X-Actor": "operator@example.com", "X-Role": "operator"}
    created = client.post("/api/tenants/7/tools/ainetscope/jobs", headers=headers, json={"artifact_name": "capture.pcapng", "artifact_type": "pcapng"})
    job_id = created.json()["job"]["job_id"]

    uploaded = client.post(f"/api/tenants/7/tools/ainetscope/jobs/{job_id}/artifact", headers=headers, content=b"\x0a\x0d\x0d\x0a\x00\x00\x00\x00")

    assert uploaded.status_code == 200
    assert uploaded.json()["job"]["state"] == "completed"
    assert uploaded.json()["analysis"]["schema"] == "datasnare-ainetscope/analysis-v1"
    assert uploaded.json()["analysis"]["format"] == "pcapng"


def test_ainetscope_upload_rejects_invalid_capture_and_marks_job_failed():
    client = TestClient(create_app())
    headers = {"X-Actor": "operator@example.com", "X-Role": "operator"}
    created = client.post("/api/tenants/7/tools/ainetscope/jobs", headers=headers, json={"artifact_name": "capture.pcap", "artifact_type": "pcap"})
    job_id = created.json()["job"]["job_id"]

    uploaded = client.post(f"/api/tenants/7/tools/ainetscope/jobs/{job_id}/artifact", headers=headers, content=b"not-a-capture")

    assert uploaded.status_code == 422
    status = client.get(f"/api/tenants/7/tools/ainetscope/jobs/{job_id}", headers=headers)
    assert status.json()["job"]["state"] == "failed"