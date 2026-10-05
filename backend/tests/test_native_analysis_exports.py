import json
import pathlib
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from app.main import create_app


HEADERS = {"X-Actor": "operator@example.com", "X-Role": "operator"}


def test_procmon_export_enters_tenant_evidence():
    client = TestClient(create_app())
    document = {"schema": "datasnare-aiprocmon/events-v1", "source": {"name": "trace.csv"},
                "salientEvents": [{"timestamp": "2026-10-04T12:00:00.123Z", "severity": "error",
                                   "summary": "Access denied", "process": "api.exe", "rowNumber": 17}],
                "coreContext": {"account": {"tenantId": 999}}}
    response = client.post("/api/tenants/7/tools/aiprocmon/jobs", headers=HEADERS,
                           json={"artifact_name": "analysis.json", "artifact_type": "json"})
    assert response.status_code == 200
    job_id = response.json()["job"]["job_id"]
    uploaded = client.post(f"/api/tenants/7/tools/aiprocmon/jobs/{job_id}/artifact", headers=HEADERS, content=json.dumps(document).encode())
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["evidence"]["tenant_id"] == 7
    event = uploaded.json()["evidence"]["events"][0]
    assert event["process"] == "api.exe"
    assert event["evidence"] == {"sourceFile": "trace.csv", "sourceLine": 17}
    catalog = client.get("/api/tenants/7/analysis/evidence", headers=HEADERS).json()
    assert catalog["items"][0]["event_count"] == 1
    assert client.get(f"/api/tenants/8/tools/aiprocmon/jobs/{job_id}", headers=HEADERS).status_code == 404


@pytest.mark.parametrize("document", [{"schema": "wrong"}, {"schema": "datasnare-aiprocmon/events-v1", "salientEvents": {}},
                                      {"schema": "datasnare-aiprocmon/events-v1", "salientEvents": [{}] * 10001}])
def test_procmon_invalid_exports_fail_job(document):
    client = TestClient(create_app())
    job_id = client.post("/api/tenants/7/tools/aiprocmon/jobs", headers=HEADERS,
                         json={"artifact_name": "analysis.json", "artifact_type": "json"}).json()["job"]["job_id"]
    response = client.post(f"/api/tenants/7/tools/aiprocmon/jobs/{job_id}/artifact", headers=HEADERS, content=json.dumps(document).encode())
    assert response.status_code == 422
    assert client.get(f"/api/tenants/7/tools/aiprocmon/jobs/{job_id}", headers=HEADERS).json()["job"]["state"] == "failed"


def test_perf_export_preserves_epoch_time_and_counter_evidence():
    client = TestClient(create_app())
    document = {"schema": "datasnare-aiperf/events-v1", "events": [{
        "timestamp": 1790985600.123, "severity": "critical", "summary": "CPU saturated",
        "host": "SQL01", "evidence": {"counter": "Processor Time", "threshold": 95, "observed": 99},
    }]}
    job_id = client.post("/api/tenants/7/tools/aiperf/jobs", headers=HEADERS,
                         json={"artifact_name": "perf.json", "artifact_type": "json"}).json()["job"]["job_id"]
    uploaded = client.post(f"/api/tenants/7/tools/aiperf/jobs/{job_id}/artifact", headers=HEADERS, content=json.dumps(document).encode())
    assert uploaded.status_code == 200, uploaded.text
    event = uploaded.json()["evidence"]["events"][0]
    assert event["timestamp"] == "2026-10-03T00:00:00.123Z"
    assert event["evidence"]["counter"] == "Processor Time"
    assert event["evidence"]["observed"] == 99
    assert uploaded.json()["evidence"]["plugin_id"] == "aiperf"


def test_procmon_real_row_fields_are_normalized():
    from app.services.native_analysis_export import analyze_native_export
    document = {"schema": "datasnare-aiprocmon/events-v1", "source": {"name": "original.csv"},
                "salientEvents": [{"row": 23, "operation": "CreateFile", "result": "ACCESS DENIED", "process": "api.exe"}]}
    event = analyze_native_export(json.dumps(document).encode(), "export.json", "aiprocmon")["events"][0]
    assert event["summary"] == "CreateFile: ACCESS DENIED"
    assert event["severity"] == "warning"
    assert event["evidence"]["sourceLine"] == 23


def test_findings_without_time_remain_untimed():
    from app.services.native_analysis_export import analyze_native_export
    document = {"schema": "datasnare-aiprocmon/events-v1", "summary": {"firstTimestamp": "2026-10-04T12:00:00Z"},
                "findings": [{"title": "Aggregate failure pattern"}]}
    event = analyze_native_export(json.dumps(document).encode(), "analysis.json", "aiprocmon")["events"][0]
    assert event["timestamp"] is None


def test_metric_preview_is_bounded_and_omits_raw_details():
    from app.routes.projects import _preview_evidence
    source = {"counter": "CPU", "observed": 99, "threshold": 95, "raw": "secret", "value": {"secret": "nested"},
              "sourceFile": "a" * 500}
    preview = _preview_evidence(source)
    assert preview["observed"] == 99
    assert len(preview["sourceFile"]) == 320
    assert "raw" not in preview
    assert "value" not in preview