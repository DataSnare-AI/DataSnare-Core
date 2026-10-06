import json
import pathlib
import sys
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from app.main import create_app
from app.services.ainetscope_export import analyze_ainetscope_export
from test_analysis_investigations import FakeInvestigationPool

HEADERS = {"X-Actor": "operator@example.com", "X-Role": "operator"}

def document():
    return {"schema": "datasnare-ainetscope/two-sided-findings-v1", "scope": {"bOffsetMs": -100},
            "metrics": {"matched": 2}, "caveats": ["Capture intervals are not verified wire latency"],
            "sources": [{"side": "A", "name": "a.pcap"}, {"side": "B", "name": "b.pcap"}],
            "findings": [{"title": "Path timing", "timestamp": "2026-10-05T12:00:00Z", "severity": "info",
                          "evidence": {"sourceFile": "a.pcap", "frameA": 1001, "frameB": 3405, "bOffsetMs": -100}},
                         {"title": "Visibility gaps", "timestamp": None}]}

def test_two_sided_import_save_reopen_preserves_context_and_untimed_findings():
    app = create_app(); client = TestClient(app)
    created = client.post('/api/tenants/7/tools/ainetscope/jobs', headers=HEADERS,
                          json={"artifact_name": "findings.json", "artifact_type": "json"})
    job_id = created.json()['job']['job_id']
    uploaded = client.post(f'/api/tenants/7/tools/ainetscope/jobs/{job_id}/artifact', headers=HEADERS,
                           content=json.dumps(document()).encode())
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()['evidence']['source_schema'] == document()['schema']
    assert uploaded.json()['evidence']['events'][1]['timestamp'] is None
    app.state.database_pool = FakeInvestigationPool()
    saved = client.post('/api/tenants/7/analysis/investigations', headers=HEADERS,
                        json={"title": "Two captures", "evidence_job_ids": [job_id]})
    assert saved.status_code == 201, saved.text
    snapshot = saved.json()['evidence'][0]
    assert snapshot['analytics']['scope']['bOffsetMs'] == -100
    assert snapshot['events'][0]['evidence']['frameB'] == 3405
    reopened = client.get(f"/api/tenants/7/analysis/investigations/{saved.json()['investigation_id']}", headers=HEADERS)
    assert reopened.json()['evidence'] == saved.json()['evidence']

def test_invalid_findings_shape_is_rejected():
    payload = document(); payload['findings'] = {}
    with pytest.raises(ValueError):
        analyze_ainetscope_export(json.dumps(payload).encode(), 'bad.json')