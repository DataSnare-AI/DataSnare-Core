import pathlib
import sys

from fastapi.testclient import TestClient

root = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "backend"))
sys.path.insert(0, str(root / "backend" / "tests"))

from app.main import create_app
from test_analysis_investigations import FakeInvestigationPool

tool_id, export_path = sys.argv[1:]
headers = {"X-Actor": "operator@example.com", "X-Role": "operator"}
app = create_app()
client = TestClient(app)
created = client.post(f"/api/tenants/7/tools/{tool_id}/jobs", headers=headers,
                      json={"artifact_name": "real-export.json", "artifact_type": "json"})
assert created.status_code == 200, created.text
job_id = created.json()["job"]["job_id"]
uploaded = client.post(f"/api/tenants/7/tools/{tool_id}/jobs/{job_id}/artifact", headers=headers,
                       content=pathlib.Path(export_path).read_bytes())
assert uploaded.status_code == 200, uploaded.text
events = uploaded.json()["evidence"]["events"]
assert events and any(event["timestamp"] for event in events)
catalog = client.get("/api/tenants/7/analysis/evidence", headers=headers)
assert catalog.json()["items"][0]["plugin_id"] == tool_id
app.state.database_pool = FakeInvestigationPool()
saved = client.post("/api/tenants/7/analysis/investigations", headers=headers,
                    json={"title": "Actual standalone export", "evidence_job_ids": [job_id]})
assert saved.status_code == 201, saved.text
reopened = client.get(f"/api/tenants/7/analysis/investigations/{saved.json()['investigation_id']}", headers=headers)
assert reopened.json()["evidence"] == saved.json()["evidence"]
if tool_id == "aiperf":
    assert any(event["evidence"].get("counter") or event["evidence"].get("metric")
               for event in reopened.json()["evidence"][0]["events"])
print(f"PASS {tool_id}: actual export API upload, catalog, saved case and reopen ({len(events)} events)")