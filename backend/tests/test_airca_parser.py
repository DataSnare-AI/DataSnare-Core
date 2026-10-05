import json
import pathlib
import sys

import pytest
from fastapi.testclient import TestClient


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import create_app
from app.services.airca_parser import analyze_rootcause_investigation


HEADERS = {"X-Actor": "operator@example.com", "X-Role": "operator"}


def export_document():
    return {
        "schema": "datasnare-rootcause/investigation-v1",
        "name": "API outage review",
        "sources": [{"id": "source-1", "name": "service.log"}],
        "events": [{
            "timestamp": 1790985600.123,
            "severity": "warn",
            "category": "log",
            "host": "api-01",
            "process": "api",
            "summary": "Connection pool exhausted",
            "detail": {"line": 17, "message": "pool limit reached"},
            "sourceId": "source-1",
            "evidence": {"sourceLine": 17, "frame": 44},
        }],
        "report": {"problemStatement": "API requests timed out", "rootCause": "Pool exhaustion"},
    }


def test_airca_parser_normalizes_export_events_findings_and_provenance():
    analysis = analyze_rootcause_investigation(json.dumps(export_document()).encode(), "review.json")

    assert analysis["event_count"] == 1
    assert analysis["events"][0]["timestamp"] == "2026-10-03T00:00:00.123Z"
    assert analysis["events"][0]["severity"] == "warning"
    assert analysis["events"][0]["evidence"] == {"sourceFile": "service.log", "sourceLine": 17, "packetNumber": 44}
    assert [finding["category"] for finding in analysis["findings"]] == ["problemStatement", "rootCause"]


def test_airca_tool_upload_becomes_tenant_scoped_normalized_evidence():
    client = TestClient(create_app())
    created = client.post(
        "/api/tenants/7/tools/airca/jobs",
        headers=HEADERS,
        json={"artifact_name": "review.json", "artifact_type": "json"},
    )
    assert created.status_code == 200, created.text
    job_id = created.json()["job"]["job_id"]

    uploaded = client.post(
        f"/api/tenants/7/tools/airca/jobs/{job_id}/artifact",
        headers=HEADERS,
        content=json.dumps(export_document()).encode(),
    )

    assert uploaded.status_code == 200, uploaded.text
    result = uploaded.json()
    assert result["job"]["state"] == "completed"
    assert result["evidence"]["tenant_id"] == 7
    assert result["evidence"]["plugin_id"] == "airca"
    assert result["evidence"]["source_schema"] == "datasnare-rootcause/investigation-v1"
    assert result["analysis"]["event_count"] == 1
    assert result["evidence"]["findings"][1]["title"] == "Root cause"
    catalog = client.get("/api/tenants/7/analysis/evidence", headers=HEADERS).json()
    assert catalog["items"][0]["job_id"] == job_id
    assert catalog["items"][0]["event_preview"][0]["host"] == "api-01"


def test_airca_import_rejects_wrong_schema_and_unsupported_extensions():
    client = TestClient(create_app())
    headers = {**HEADERS, "Content-Type": "application/json"}
    wrong_type = client.post(
        "/api/tenants/7/tools/airca/jobs",
        headers=HEADERS,
        json={"artifact_name": "notes.txt", "artifact_type": "txt"},
    )
    assert wrong_type.status_code == 400

    job_id = client.post(
        "/api/tenants/7/tools/airca/jobs",
        headers=HEADERS,
        json={"artifact_name": "review.json", "artifact_type": "json"},
    ).json()["job"]["job_id"]
    response = client.post(
        f"/api/tenants/7/tools/airca/jobs/{job_id}/artifact",
        headers=headers,
        content=b'{"schema":"other/v1","events":[]}',
    )
    assert response.status_code == 422
    assert "requires schema" in response.json()["detail"]


def test_airca_parser_rejects_oversized_event_lists():
    document = export_document()
    document["events"] = [{}] * 10_001
    with pytest.raises(ValueError, match="limited to 10000 events"):
        analyze_rootcause_investigation(json.dumps(document).encode(), "review.json")


def test_airca_parser_rejects_excessively_nested_json_without_server_error():
    with pytest.raises(ValueError, match="valid UTF-8 JSON"):
        analyze_rootcause_investigation((b"{" + b'"nested":' * 2000 + b"null" + b"}" * 2000), "review.json")