import pathlib
import sys

from fastapi.testclient import TestClient


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import create_app


HEADERS = {"X-Actor": "operator@example.com", "X-Role": "operator"}


def _create(client, tool_id, artifact_name, artifact_type, **context):
    response = client.post(
        f"/api/tenants/7/tools/{tool_id}/jobs",
        headers=HEADERS,
        json={"artifact_name": artifact_name, "artifact_type": artifact_type, **context},
    )
    assert response.status_code == 200, response.text
    return response.json()["job"]["job_id"]


def test_aiperf_csv_upload_returns_normalized_threshold_event_and_indexes_it():
    client = TestClient(create_app())
    job_id = _create(client, "aiperf", "cpu.csv", "csv")
    csv_data = (
        "Timestamp,\\\\APP01\\Processor(_Total)\\% Processor Time\n"
        "2026-09-28T10:00:00Z,96\n"
        "2026-09-28T10:00:30Z,97\n"
    ).encode()

    response = client.post(f"/api/tenants/7/tools/aiperf/jobs/{job_id}/artifact", headers=HEADERS, content=csv_data)

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["normalized_schema"] == "datasnare-aiperf/events-v1"
    assert payload["job"]["state"] == "completed"
    assert payload["analysis"]["event_count"] == 2
    catalog = client.get("/api/tenants/7/knowledge/catalog", headers=HEADERS).json()
    assert catalog["item_count"] == 1


def test_tool_upload_persists_raw_artifact_when_storage_is_enabled():
    class FakeArtifactStorage:
        stored = None

        async def store(self, **values):
            self.stored = values
            return {"artifact_id": "artifact-1", "size_bytes": len(values["content"]), "sha256": "abc"}

    app = create_app()
    storage = FakeArtifactStorage()
    app.state.artifact_storage = storage
    client = TestClient(app)
    job_id = _create(client, "aiperf", "cpu.csv", "csv")
    csv_data = b"Timestamp,CPU\n2026-09-28T10:00:00Z,20\n"

    response = client.post(
        f"/api/tenants/7/tools/aiperf/jobs/{job_id}/artifact",
        headers={**HEADERS, "Content-Type": "text/csv"},
        content=csv_data,
    )

    assert response.status_code == 200, response.text
    assert response.json()["artifact"]["artifact_id"] == "artifact-1"
    assert storage.stored["tenant_id"] == 7
    assert storage.stored["product_key"] == "aiperf"
    assert storage.stored["job_id"] == job_id
    assert storage.stored["content"] == csv_data


def test_aiprocmon_csv_requires_capture_context_and_indexes_events():
    client = TestClient(create_app())
    missing_context_job = _create(client, "aiprocmon", "trace.csv", "csv")
    csv_data = b'Time of Day,Process Name,PID,Operation,Path,Result,Detail\n10:00:00.000,app.exe,20,CreateFile,C:\\\\data,ACCESS DENIED,\n'
    missing = client.post(f"/api/tenants/7/tools/aiprocmon/jobs/{missing_context_job}/artifact", headers=HEADERS, content=csv_data)
    assert missing.status_code == 422
    assert "capture date and UTC offset" in missing.json()["detail"]

    job_id = _create(client, "aiprocmon", "trace.csv", "csv", capture_date="2026-09-28", timezone_offset="-04:00")
    response = client.post(f"/api/tenants/7/tools/aiprocmon/jobs/{job_id}/artifact", headers=HEADERS, content=csv_data)

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["normalized_schema"] == "datasnare-aiprocmon/events-v1"
    assert payload["analysis"]["events"] == 1
    assert payload["analysis"]["preview"][0]["timestamp"] == "2026-09-28T14:00:00Z"
    assert payload["analysis"]["preview"][0]["severity"] == "error"


def test_native_pml_upload_reports_required_windows_conversion():
    client = TestClient(create_app())
    job_id = _create(client, "aiprocmon", "trace.pml", "pml")

    response = client.post(f"/api/tenants/7/tools/aiprocmon/jobs/{job_id}/artifact", headers=HEADERS, content=b"PML")

    assert response.status_code == 422
    assert "Windows converter" in response.json()["detail"]


def test_aiperf_diagnostics_xml_returns_normalized_advice():
    client = TestClient(create_app())
    job_id = _create(client, "aiperf", "report.xml", "xml")
    xml_data = b'<Report name="systemDiagnostics"><Advice><Item>Critical disk latency problem</Item></Advice></Report>'

    response = client.post(f"/api/tenants/7/tools/aiperf/jobs/{job_id}/artifact", headers=HEADERS, content=xml_data)

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["analysis"]["parser"] == "aiperf-diagnostics-xml-v1"
    assert payload["analysis"]["event_count"] == 1
    assert payload["analysis"]["events"][0]["severity"] == "critical"


def test_aiprocmon_xml_returns_normalized_operation():
    client = TestClient(create_app())
    job_id = _create(client, "aiprocmon", "trace.xml", "xml")
    xml_data = b'<events><event><Time>2026-09-28T10:00:00Z</Time><Process_Name>app.exe</Process_Name><Operation>CreateFile</Operation><Path>/data</Path><Result>ACCESS DENIED</Result></event></events>'

    response = client.post(f"/api/tenants/7/tools/aiprocmon/jobs/{job_id}/artifact", headers=HEADERS, content=xml_data)

    assert response.status_code == 200, response.text
    event = response.json()["analysis"]["preview"][0]
    assert event["timestamp"] == "2026-09-28T10:00:00Z"
    assert event["process"] == "app.exe"
    assert event["severity"] == "error"
