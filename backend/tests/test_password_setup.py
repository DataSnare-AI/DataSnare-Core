import hashlib
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import FastAPI
from fastapi.testclient import TestClient

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.routes.admin_users import router as admin_router
from app.routes.auth import router as auth_router


class FakeSetupPool:
    def __init__(self, token_row=None, user=None):
        self.token_row = token_row
        self.user = user
        self.executed = []

    async def fetchrow(self, query, *args):
        if "core_password_setup_tokens" in query:
            return self.token_row
        if "FROM core_users" in query:
            return self.user
        return None

    async def execute(self, query, *args):
        self.executed.append((query, args))
        return "UPDATE 1"

    async def fetchval(self, query, *args):
        return None


class FakeProvider:
    async def profile(self, authorization: str):
        return {"username": "admin", "actor_id": "admin", "role": "platform_admin"}


def build_client(pool):
    app = FastAPI()
    app.state.auth_provider = FakeProvider()
    app.state.database_pool = pool
    app.include_router(auth_router)
    app.include_router(admin_router)
    return TestClient(app)


def future(hours=24):
    return datetime.now(timezone.utc) + timedelta(hours=hours)


def test_issued_setup_token_is_stored_only_as_a_hash():
    pool = FakeSetupPool(user={"username": "bob", "display_name": "Bob", "email": "bob@example.test"})
    client = build_client(pool)

    response = client.post(
        "/api/admin/users/bob/password-setup-token",
        headers={"Authorization": "Bearer session"},
        json={"expires_in_hours": 48},
    )

    assert response.status_code == 201
    raw_token = response.json()["token"]
    inserted = [args for query, args in pool.executed if "INSERT INTO core_password_setup_tokens" in query]
    assert inserted, "token row was not inserted"
    assert inserted[0][0] == hashlib.sha256(raw_token.encode()).hexdigest()
    assert raw_token not in inserted[0]


def test_setup_token_requires_a_recipient_email():
    pool = FakeSetupPool(user={"username": "bob", "display_name": "Bob", "email": None})
    client = build_client(pool)

    response = client.post(
        "/api/admin/users/bob/password-setup-token",
        headers={"Authorization": "Bearer session"},
        json={},
    )

    assert response.status_code == 400


def test_completing_setup_stores_bcrypt_hash_and_revokes_sessions():
    pool = FakeSetupPool(token_row={
        "username": "bob", "email": "bob@example.test", "display_name": "Bob",
        "expires_at": future(), "consumed_at": None,
    })
    client = build_client(pool)

    response = client.post(
        "/api/auth/password-setup/complete",
        json={"token": "raw-token", "password": "a sufficiently long secret"},
    )

    assert response.status_code == 200
    update = next(args for query, args in pool.executed if "SET password_hash" in query)
    assert bcrypt.checkpw(b"a sufficiently long secret", update[1].encode())
    assert any("core_auth_sessions" in query for query, _ in pool.executed)


def test_expired_token_cannot_complete_setup():
    pool = FakeSetupPool(token_row={
        "username": "bob", "email": None, "display_name": "Bob",
        "expires_at": datetime.now(timezone.utc) - timedelta(hours=1), "consumed_at": None,
    })
    client = build_client(pool)

    response = client.post(
        "/api/auth/password-setup/complete",
        json={"token": "raw-token", "password": "a sufficiently long secret"},
    )

    assert response.status_code == 400


def test_already_used_token_cannot_be_replayed():
    pool = FakeSetupPool(token_row={
        "username": "bob", "email": None, "display_name": "Bob",
        "expires_at": future(), "consumed_at": datetime.now(timezone.utc),
    })
    client = build_client(pool)

    response = client.post(
        "/api/auth/password-setup/complete",
        json={"token": "raw-token", "password": "a sufficiently long secret"},
    )

    assert response.status_code == 400


def test_short_password_is_rejected():
    pool = FakeSetupPool(token_row={
        "username": "bob", "email": None, "display_name": "Bob",
        "expires_at": future(), "consumed_at": None,
    })
    client = build_client(pool)

    response = client.post("/api/auth/password-setup/complete", json={"token": "raw-token", "password": "short"})

    assert response.status_code == 422


def test_validate_returns_account_context_without_exposing_the_token():
    pool = FakeSetupPool(token_row={
        "username": "bob", "email": "bob@example.test", "display_name": "Bob",
        "expires_at": future(), "consumed_at": None,
    })
    client = build_client(pool)

    payload = client.get("/api/auth/password-setup/validate", params={"token": "raw-token"}).json()

    assert payload["valid"] is True
    assert payload["username"] == "bob"
    assert "token" not in payload
