import pathlib
import sys

from fastapi.testclient import TestClient


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import create_app


def test_ainetscope_web_job_is_queued_and_can_be_fetched():
    client = TestClient(create_app())
    headers = {"X-Actor": "operator@example.com", "X-Role": "operator"}

    created = client.post(
        "/api/tenants/7/tools/ainetscope/jobs",
        headers=headers,
        json={"artifact_name": "capture.pcapng", "artifact_type": "pcapng", "file_size_bytes": 1024},
    )

    assert created.status_code == 200
    payload = created.json()
    assert payload["schema"] == "datasnare-ainetscope/job-v1"
    assert payload["job"]["state"] == "queued"
    assert payload["job"]["normalized_schema"] == "datasnare-ainetscope/analysis-v1"

    fetched = client.get(f"/api/tenants/7/tools/ainetscope/jobs/{payload['job']['job_id']}", headers=headers)
    assert fetched.status_code == 200
    assert fetched.json()["job"]["artifact_name"] == "capture.pcapng"


def test_ainetscope_web_job_rejects_non_capture_artifact():
    client = TestClient(create_app())

    response = client.post(
        "/api/tenants/7/tools/ainetscope/jobs",
        headers={"X-Actor": "operator@example.com", "X-Role": "operator"},
        json={"artifact_name": "notes.log", "artifact_type": "log"},
    )

    assert response.status_code == 400