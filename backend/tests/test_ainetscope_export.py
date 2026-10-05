import json
import pathlib
import sys

import pytest
from fastapi.testclient import TestClient


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import create_app
from app.services.ainetscope_export import analyze_ainetscope_export


HEADERS = {"X-Actor": "operator@example.com", "X-Role": "operator"}


def export_document():
    return {
        "schema": "datasnare-ainetscope/analysis-v1",
        "generatedAt": "2026-10-02T12:00:00.123Z",
        "profile": {"name": "Database analysis"},
        "processAttribution": {"processes": [{"process": "api.exe"}]},
        "capture": {"name": "database.pcapng", "packets": 840, "bytes": 125000, "hosts": 4, "start": 1790940000.123},
        "flows": [{
            "key": "tcp|192.0.2.10|198.51.100.20",
            "protocol": "TCP",
            "a": "192.0.2.10:53120",
            "b": "198.51.100.20:5432",
            "first": 1790940000.123,
            "packets": 50,
            "bytes": 64000,
            "latencyValue": 12.5,
            "state": "Established",
            "resets": 1,
            "packetData": [{"raw": "must not be retained"}],
        }],
        "services": [{"name": "PostgreSQL", "requests": 12}],
        "findings": [{"severity": "high", "title": "TCP sessions reset", "detail": "One database flow reset", "packet": 44}],
    }


def test_export_parser_normalizes_flows_and_findings_without_packet_payloads():
    result = analyze_ainetscope_export(json.dumps(export_document()).encode(), "analysis.json")

    assert result["event_count"] == 2
    assert result["preview"][0]["severity"] == "critical"
    assert result["preview"][0]["timestamp"] == "2026-10-02T12:00:00.123Z"
    assert result["preview"][0]["evidence"] == {"sourceFile": "analysis.json", "packetNumber": 44}
    assert result["preview"][1]["summary"] == "TCP 192.0.2.10:53120 <-> 198.51.100.20:5432"
    assert result["preview"][1]["detail"]["bytes"] == 64000
    assert "packetData" not in result["preview"][1]["detail"]
    assert result["flows"] == 1
    assert result["packets"] == 840


def test_analysis_json_upload_enters_tenant_evidence_and_can_be_saved():
    app = create_app()
    client = TestClient(app)
    encoded = json.dumps(export_document()).encode()
    created = client.post(
        "/api/tenants/7/tools/ainetscope/jobs",
        headers=HEADERS,
        json={"artifact_name": "database-analysis.json", "artifact_type": "json", "file_size_bytes": len(encoded)},
    )
    assert created.status_code == 200, created.text
    job_id = created.json()["job"]["job_id"]

    uploaded = client.post(
        f"/api/tenants/7/tools/ainetscope/jobs/{job_id}/artifact",
        headers=HEADERS,
        content=encoded,
    )

    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["job"]["state"] == "completed"
    assert uploaded.json()["evidence"]["plugin_id"] == "ainetscope"
    assert uploaded.json()["evidence"]["events"][1]["category"] == "network.flow.tcp"
    listed = client.get("/api/tenants/7/analysis/evidence", headers=HEADERS)
    assert listed.status_code == 200
    assert listed.json()["items"][0]["job_id"] == job_id
    assert listed.json()["items"][0]["event_count"] == 2


@pytest.mark.parametrize("payload", [
    b"not json",
    b'{"schema":"other/v1","flows":[],"findings":[]}',
    b'{"schema":"datasnare-ainetscope/analysis-v1","flows":{},"findings":[]}',
])
def test_analysis_export_rejects_malformed_schema_and_shapes(payload):
    with pytest.raises(ValueError):
        analyze_ainetscope_export(payload, "analysis.json")


def test_analysis_export_rejects_too_many_events():
    document = export_document()
    document["flows"] = [{}] * 10_001
    with pytest.raises(ValueError, match="limited to 10000"):
        analyze_ainetscope_export(json.dumps(document).encode(), "analysis.json")