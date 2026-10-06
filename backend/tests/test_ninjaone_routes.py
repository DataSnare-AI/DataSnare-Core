import pathlib
import sys

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import create_app


def test_connection_requires_actor():
    client = TestClient(create_app())

    response = client.get("/api/tenants/7/integrations/ninjaone/connection")

    assert response.status_code == 401


def test_authorize_stores_redacted_tenant_connection_and_returns_oauth_url(monkeypatch):
    monkeypatch.setenv("CORE_STORAGE_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv(
        "NINJAONE_REDIRECT_URI",
        "https://staging.app.datasnare.com/api/integrations/ninjaone/callback",
    )
    client = TestClient(create_app())

    response = client.post(
        "/api/tenants/7/integrations/ninjaone/authorize",
        headers={"X-Actor": "admin@example.com", "X-Role": "tenant_admin"},
        json={
            "base_url": "https://api.ninjarmm.com",
            "client_id": "ninja-client",
            "client_secret": "ninja-secret",
            "redirect_uri": "https://staging.app.datasnare.com/api/integrations/ninjaone/callback",
            "scopes": ["monitoring"],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert "response_type=code" in payload["authorization_url"]
    assert "client_secret" not in payload["authorization_url"]
    assert payload["state"]
    stored = client.app.state.partner_connections._records[(7, "ninjaone")]
    assert stored.encrypted_client_secret != "ninja-secret"
    assert "ninja-secret" not in response.text

    status = client.get(
        "/api/tenants/7/integrations/ninjaone/connection",
        headers={"X-Actor": "admin@example.com", "X-Role": "tenant_admin"},
    )
    assert status.status_code == 200
    assert status.json()["client_id"] == "ninja-client"
    assert "ninja-secret" not in status.text


def test_callback_persists_encrypted_refresh_token_once(monkeypatch):
    encryption_key = Fernet.generate_key().decode()
    monkeypatch.setenv("CORE_STORAGE_ENCRYPTION_KEY", encryption_key)
    monkeypatch.setenv(
        "NINJAONE_REDIRECT_URI",
        "https://staging.app.datasnare.com/api/integrations/ninjaone/callback",
    )
    app = create_app()

    async def fake_exchange(config, code, session):
        assert config.client_secret == "ninja-secret"
        assert code == "oauth-code"
        return {"access_token": "access-secret", "refresh_token": "refresh-secret"}

    import app.routes.ninjaone as ninjaone_routes

    monkeypatch.setattr(ninjaone_routes, "exchange_authorization_code", fake_exchange)
    client = TestClient(app)
    start = client.post(
        "/api/tenants/7/integrations/ninjaone/authorize",
        headers={"X-Actor": "admin@example.com", "X-Role": "tenant_admin"},
        json={
            "base_url": "https://api.ninjarmm.com",
            "client_id": "ninja-client",
            "client_secret": "ninja-secret",
            "redirect_uri": "https://staging.app.datasnare.com/api/integrations/ninjaone/callback",
            "scopes": ["monitoring"],
        },
    )
    state = start.json()["state"]

    callback = client.get(
        "/api/integrations/ninjaone/callback",
        params={"state": state, "code": "oauth-code"},
    )

    assert callback.status_code == 200
    assert callback.json() == {"provider": "ninjaone", "tenant_id": 7, "connected": True}
    saved = app.state.partner_connections._records[(7, "ninjaone")]
    assert saved.connected is True
    assert Fernet(encryption_key.encode()).decrypt(saved.encrypted_refresh_token.encode()).decode() == "refresh-secret"
    replay = client.get(
        "/api/integrations/ninjaone/callback",
        params={"state": state, "code": "oauth-code"},
    )
    assert replay.status_code == 400


def test_authorize_rejects_non_read_only_scopes(monkeypatch):
    monkeypatch.setenv("CORE_STORAGE_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv(
        "NINJAONE_REDIRECT_URI",
        "https://staging.app.datasnare.com/api/integrations/ninjaone/callback",
    )
    client = TestClient(create_app())
    response = client.post(
        "/api/tenants/7/integrations/ninjaone/authorize",
        headers={"X-Actor": "admin@example.com", "X-Role": "tenant_admin"},
        json={
            "base_url": "https://api.ninjarmm.com",
            "client_id": "ninja-client",
            "client_secret": "ninja-secret",
            "redirect_uri": "https://staging.app.datasnare.com/api/integrations/ninjaone/callback",
            "scopes": ["monitoring", "management"],
        },
    )
    assert response.status_code == 400


def test_authorize_rejects_actor_without_tenant_admin_permission(monkeypatch):
    monkeypatch.setenv("NINJAONE_REDIRECT_URI", "https://staging.app.datasnare.com/api/integrations/ninjaone/callback")
    client = TestClient(create_app())
    response = client.post(
        "/api/tenants/7/integrations/ninjaone/authorize",
        headers={"X-Actor": "operator@example.com", "X-Role": "operator"},
        json={
            "base_url": "https://api.ninjarmm.com",
            "client_id": "ninja-client",
            "client_secret": "ninja-secret",
            "redirect_uri": "https://staging.app.datasnare.com/api/integrations/ninjaone/callback",
            "scopes": ["monitoring"],
        },
    )
    assert response.status_code == 403