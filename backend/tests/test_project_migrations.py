import pathlib
import sys

from fastapi.testclient import TestClient


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import create_app


def test_web_migration_registry_lists_all_four_analysis_tools():
    response = TestClient(create_app()).get("/api/projects/web-migrations")

    assert response.status_code == 200
    projects = {project["project_id"]: project for project in response.json()["projects"]}
    assert set(projects) == {"ailogscope", "aiperf", "aiprocmon", "ainetscope"}
    assert all(project["frontend"] == "react" and project["backend"] == "python" for project in projects.values())
    assert projects["ainetscope"]["normalized_schema"] == "datasnare-ainetscope/analysis-v1"


def test_ainetscope_and_ailogscope_native_jobs_are_accepted():
    client = TestClient(create_app())
    headers = {"X-Actor": "operator@example.com", "X-Role": "operator"}

    for tool_id, artifact_name, artifact_type in [
        ("ainetscope", "capture.pcapng", "pcapng"),
        ("ailogscope", "application.log", "log"),
    ]:
        response = client.post(
            "/api/tenants/7/ingest/jobs",
            headers=headers,
            json={"tool_id": tool_id, "artifact_name": artifact_name, "artifact_type": artifact_type},
        )
        assert response.status_code == 200
        assert response.json()["normalized_schema"].startswith("datasnare-")


def test_analysis_plugin_catalog_exposes_contract_without_enabling_execution():
    response = TestClient(create_app()).get("/api/projects/analysis-plugins")

    assert response.status_code == 200
    payload = response.json()
    assert payload["plugin_contract"] == "datasnare-analysis-plugin/v1"
    assert payload["evidence_envelope"] == "datasnare-analysis-evidence/v1"
    assert payload["execution_enabled"] is False
    plugins = {plugin["plugin_id"]: plugin for plugin in payload["plugins"]}
    assert set(plugins) == {"airca", "ailogscope", "aiperf", "aiprocmon", "ainetscope", "aimemorydump"}
    assert plugins["aimemorydump"]["status"] == "planned"


def test_analysis_evidence_feed_is_tenant_scoped_and_returns_summaries_only():
    client = TestClient(create_app())
    headers = {"X-Actor": "operator@example.com", "X-Role": "operator"}
    created = client.post(
        "/api/tenants/7/tools/ailogscope/jobs",
        headers=headers,
        json={"artifact_name": "service.log", "artifact_type": "log"},
    )
    job_id = created.json()["job"]["job_id"]
    uploaded = client.post(
        f"/api/tenants/7/tools/ailogscope/jobs/{job_id}/artifact",
        headers=headers,
        content=b"2026-10-01T10:00:00Z ERROR database unavailable\n",
    )
    assert uploaded.status_code == 200

    response = client.get("/api/tenants/7/analysis/evidence?limit=10", headers=headers)
    other_tenant = client.get("/api/tenants/8/analysis/evidence", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["items"]) == 1
    assert payload["items"][0]["plugin_id"] == "ailogscope"
    assert payload["items"][0]["job_id"] == job_id
    assert payload["items"][0]["event_count"] == 1
    assert len(payload["items"][0]["event_preview"]) == 1
    assert payload["items"][0]["event_preview"][0]["severity"] == "error"
    assert "detail" not in payload["items"][0]["event_preview"][0]
    capped = client.get("/api/tenants/7/analysis/evidence?events_per_item=0", headers=headers)
    assert len(capped.json()["items"][0]["event_preview"]) == 1
    assert other_tenant.json()["items"] == []


def test_analysis_evidence_event_preview_has_a_server_side_upper_bound():
    client = TestClient(create_app())
    headers = {"X-Actor": "operator@example.com", "X-Role": "operator"}
    created = client.post(
        "/api/tenants/7/tools/ailogscope/jobs",
        headers=headers,
        json={"artifact_name": "many-events.log", "artifact_type": "log"},
    )
    job_id = created.json()["job"]["job_id"]
    content = "".join(f"2026-10-01T10:00:{second:02d}Z INFO sample {second}\n" for second in range(25)).encode()
    uploaded = client.post(
        f"/api/tenants/7/tools/ailogscope/jobs/{job_id}/artifact",
        headers=headers,
        content=content,
    )
    assert uploaded.status_code == 200

    response = client.get(
        "/api/tenants/7/analysis/evidence?events_per_item=200",
        headers=headers,
    )

    item = next(row for row in response.json()["items"] if row["job_id"] == job_id)
    assert item["event_count"] == 25
    assert len(item["event_preview"]) == 20