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