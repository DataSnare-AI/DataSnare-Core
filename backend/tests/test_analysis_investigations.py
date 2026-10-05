import json
import pathlib
import sys
from datetime import datetime, timezone

from fastapi.testclient import TestClient

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import create_app
from app.repositories.ingest_jobs import InMemoryIngestJobRepository, IngestJobRecord


class FakeInvestigationPool:
    def __init__(self):
        self.rows = {}

    async def fetchrow(self, query, *args):
        if "INSERT INTO analysis_investigations" in query:
            now = datetime.now(timezone.utc)
            row = {
                "investigation_id": args[0],
                "tenant_id": args[1],
                "title": args[2],
                "description": args[3],
                "evidence": json.loads(args[4]),
                "created_by": args[5],
                "metadata": json.loads(args[6]),
                "status": "open",
                "created_at": now,
                "updated_at": now,
            }
            self.rows[(row["tenant_id"], row["investigation_id"])] = row
            return row
        if "FROM analysis_investigations" in query:
            return self.rows.get((args[0], args[1]))
        return None

    async def fetch(self, query, *args):
        tenant_id, limit = args
        rows = [row for (row_tenant, _), row in self.rows.items() if row_tenant == tenant_id]
        rows.sort(key=lambda row: row["created_at"], reverse=True)
        return [
            {**row, "evidence_count": len(row["evidence"])}
            for row in rows[:limit]
        ]


def _app_with_completed_job():
    jobs = InMemoryIngestJobRepository()
    job_id = "job-log-1"
    jobs._records[(7, job_id)] = IngestJobRecord(
        tenant_id=7,
        tool_id="ailogscope",
        artifact_name="service.log",
        artifact_type="log",
        requested_by="operator@example.com",
        job_id=job_id,
        state="completed",
        normalized_schema="datasnare-ailogscope/events-v1",
        native_conversion={
            "knowledge_item_id": "knowledge-1",
            "evidence_envelope": {
                "plugin_version": "0.1.0",
                "source_schema": "datasnare-ailogscope/events-v1",
                "metadata": {"event_count": 1},
                "findings": [],
                "events": [{
                    "timestamp": "2026-10-01T10:00:00Z",
                    "severity": "error",
                    "summary": "Database unavailable",
                    "detail": {"sensitive": "raw detail omitted"},
                    "evidence": {"sourceLine": 12},
                }],
            },
        },
    )
    app = create_app(ingest_jobs=jobs)
    app.state.database_pool = FakeInvestigationPool()
    return app


def test_investigation_create_list_and_reopen_snapshot_within_tenant():
    client = TestClient(_app_with_completed_job())
    headers = {"X-Actor": "operator@example.com", "X-Role": "operator"}

    created = client.post(
        "/api/tenants/7/analysis/investigations",
        headers=headers,
        json={"title": "Database incident", "description": "Morning outage", "evidence_job_ids": ["job-log-1"], "metadata": {"incident_at": "2026-10-01T10:00:00.123Z", "window_start": "2026-10-01T09:59:00Z", "window_end": "2026-10-01T10:01:00Z", "incident_description": "Database unavailable", "working_note": "Check preceding events"}},
    )

    assert created.status_code == 201, created.text
    payload = created.json()
    assert payload["title"] == "Database incident"
    assert datetime.fromisoformat(payload["metadata"]["incident_at"].replace("Z", "+00:00")) == datetime(2026, 10, 1, 10, 0, 0, 123000, tzinfo=timezone.utc)
    assert payload["evidence"][0]["start_time"] == "2026-10-01T10:00:00+00:00"
    assert payload["evidence"][0]["events"][0]["summary"] == "Database unavailable"
    assert "detail" not in payload["evidence"][0]["events"][0]

    listed = client.get("/api/tenants/7/analysis/investigations", headers=headers)
    reopened = client.get(
        f"/api/tenants/7/analysis/investigations/{payload['investigation_id']}",
        headers=headers,
    )
    other_tenant = client.get(
        f"/api/tenants/8/analysis/investigations/{payload['investigation_id']}",
        headers=headers,
    )

    assert listed.status_code == 200
    assert listed.json()["investigations"][0]["evidence_count"] == 1
    assert reopened.json()["evidence"] == payload["evidence"]
    assert reopened.json()["metadata"] == payload["metadata"]
    assert other_tenant.status_code == 404


def test_airca_import_can_be_saved_and_reopened_as_investigation_evidence():
    app = _app_with_completed_job()
    job_id = "job-airca-1"
    app.state.ingest_jobs._records[(7, job_id)] = IngestJobRecord(
        tenant_id=7,
        tool_id="airca",
        artifact_name="root-cause.json",
        artifact_type="json",
        requested_by="operator@example.com",
        job_id=job_id,
        state="completed",
        normalized_schema="datasnare-rootcause/investigation-v1",
        native_conversion={
            "evidence_envelope": {
                "plugin_version": "0.1.0",
                "source_schema": "datasnare-rootcause/investigation-v1",
                "metadata": {"event_count": 1},
                "findings": [{"title": "Root cause", "detail": "Pool exhaustion"}],
                "events": [{
                    "timestamp": "2026-10-03T00:00:00.123Z",
                    "severity": "warning",
                    "summary": "Connection pool exhausted",
                    "evidence": {"sourceFile": "service.log", "sourceLine": 17},
                }],
            },
        },
    )
    client = TestClient(app)
    headers = {"X-Actor": "operator@example.com", "X-Role": "operator"}

    created = client.post(
        "/api/tenants/7/analysis/investigations",
        headers=headers,
        json={"title": "Pool outage", "evidence_job_ids": [job_id]},
    )

    assert created.status_code == 201, created.text
    evidence = created.json()["evidence"][0]
    assert evidence["plugin_id"] == "airca"
    assert evidence["event_count"] == 1
    assert evidence["events"][0]["summary"] == "Connection pool exhausted"
    assert evidence["events"][0]["evidence"] == {"sourceFile": "service.log", "sourceLine": 17}
    reopened = client.get(
        f"/api/tenants/7/analysis/investigations/{created.json()['investigation_id']}",
        headers=headers,
    )
    assert reopened.status_code == 200
    assert reopened.json()["evidence"] == created.json()["evidence"]


def test_investigation_create_rejects_viewer_and_unknown_evidence():
    client = TestClient(_app_with_completed_job())
    viewer = client.post(
        "/api/tenants/7/analysis/investigations",
        headers={"X-Actor": "viewer@example.com", "X-Role": "viewer"},
        json={"title": "Denied", "evidence_job_ids": ["job-log-1"]},
    )
    missing = client.post(
        "/api/tenants/7/analysis/investigations",
        headers={"X-Actor": "operator@example.com", "X-Role": "operator"},
        json={"title": "Missing evidence", "evidence_job_ids": ["not-a-tenant-job"]},
    )

    assert viewer.status_code == 403
    assert missing.status_code == 404


def test_investigation_rejects_invalid_window_metadata():
    client = TestClient(_app_with_completed_job())
    headers = {"X-Actor": "operator@example.com", "X-Role": "operator"}
    for metadata in (
        {"incident_at": "2026-10-01T10:00:00"},
        {"window_start": "2026-10-01T10:00:00Z"},
        {"window_start": "2026-10-01T10:00:00Z", "window_end": "2026-10-01T09:00:00Z"},
    ):
        response = client.post(
            "/api/tenants/7/analysis/investigations",
            headers=headers,
            json={"title": "Invalid window", "evidence_job_ids": ["job-log-1"], "metadata": metadata},
        )
        assert response.status_code == 422
