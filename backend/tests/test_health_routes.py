import pathlib
import sys

from fastapi.testclient import TestClient


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import create_app


def test_development_readiness_reports_contracts_and_in_memory_mode():
    response = TestClient(create_app()).get("/api/health/readiness")

    assert response.status_code == 200
    payload = response.json()
    assert payload["schema"] == "datasnare-core/readiness-v1"
    assert payload["status"] == "ready"
    assert payload["environment"] == "development"
    assert payload["storage_mode"] == "in-memory"
    assert payload["checks"]["durable_artifact_storage"] is True
    assert payload["checks"]["tool_contracts"] is True


def test_production_readiness_requires_auth_provider_and_database(monkeypatch):
    monkeypatch.setenv("DATASNARE_ENV", "production")
    response = TestClient(create_app()).get("/api/health/readiness")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "not_ready"
    assert payload["checks"]["tenant_authentication"] is False
    assert payload["checks"]["persistent_storage"] is False
    assert payload["checks"]["durable_artifact_storage"] is False