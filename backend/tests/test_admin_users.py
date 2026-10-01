import pathlib
import sys

import bcrypt
from fastapi import FastAPI
from fastapi.testclient import TestClient

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.routes.admin_users import router


class FakeAdminPool:
    def __init__(self, rows=None, existing=None):
        self.rows = rows or []
        self.existing = existing
        self.executed = []

    async def fetch(self, query, *args):
        return self.rows

    async def fetchval(self, query, *args):
        if "DELETE FROM core_users" in query:
            return self.existing
        return self.existing

    async def fetchrow(self, query, *args):
        if "UPDATE core_users" in query and self.existing is None:
            return None
        return {
            "username": "alice",
            "display_name": "Alice",
            "email": "alice@example.test",
            "global_role": "operator",
            "is_active": True,
            "source_system": "core",
            "last_login_at": None,
            "created_at": None,
            "invite_pending": False,
        }

    async def execute(self, query, *args):
        self.executed.append((query, args))
        return "UPDATE 1"


class FakeProvider:
    def __init__(self, role="platform_admin"):
        self.role = role

    async def profile(self, authorization: str):
        return {"username": "admin", "actor_id": "admin", "role": self.role}


def build_client(pool, role="platform_admin"):
    app = FastAPI()
    app.state.auth_provider = FakeProvider(role)
    app.state.database_pool = pool
    app.include_router(router)
    return TestClient(app)


AUTH = {"Authorization": "Bearer session"}


def test_non_platform_admin_cannot_manage_users():
    client = build_client(FakeAdminPool(), role="tenant_admin")

    response = client.get("/api/admin/users", headers=AUTH)

    assert response.status_code == 403


def test_listing_users_never_exposes_password_hashes():
    rows = [{
        "username": "alice",
        "display_name": "Alice",
        "email": "alice@example.test",
        "global_role": "operator",
        "is_active": True,
        "source_system": "aiops",
        "last_login_at": None,
        "created_at": None,
        "invite_pending": False,
        "password_hash": "$2b$12$should-not-be-returned",
    }]
    client = build_client(FakeAdminPool(rows=rows))

    payload = client.get("/api/admin/users", headers=AUTH).json()

    assert "password_hash" not in payload["users"][0]
    assert payload["users"][0]["username"] == "alice"


def test_created_user_password_is_stored_as_a_bcrypt_hash():
    pool = FakeAdminPool(existing=None)
    client = build_client(pool)
    captured = {}

    async def fetchrow(query, *args):
        captured["args"] = args
        return {
            "username": "newuser", "display_name": None, "email": None,
            "global_role": "operator", "is_active": True, "source_system": "core",
            "last_login_at": None, "created_at": None, "invite_pending": False,
        }

    pool.fetchrow = fetchrow
    response = client.post(
        "/api/admin/users",
        headers=AUTH,
        json={"username": "newuser", "password": "correct horse battery", "global_role": "operator"},
    )

    assert response.status_code == 201
    stored_hash = captured["args"][1]
    assert stored_hash != "correct horse battery"
    assert bcrypt.checkpw(b"correct horse battery", stored_hash.encode())


def test_unsupported_role_is_rejected():
    client = build_client(FakeAdminPool())

    response = client.post(
        "/api/admin/users",
        headers=AUTH,
        json={"username": "newuser", "global_role": "superuser"},
    )

    assert response.status_code == 400


def test_password_change_revokes_existing_sessions():
    pool = FakeAdminPool(existing="alice")
    client = build_client(pool)

    response = client.patch("/api/admin/users/alice", headers=AUTH, json={"password": "another strong secret"})

    assert response.status_code == 200
    assert any("core_auth_sessions" in query and "revoked_at = NOW()" in query for query, _ in pool.executed)


def test_deactivating_a_user_revokes_existing_sessions():
    pool = FakeAdminPool(existing="alice")
    client = build_client(pool)

    response = client.patch("/api/admin/users/alice", headers=AUTH, json={"is_active": False})

    assert response.status_code == 200
    assert any("core_auth_sessions" in query for query, _ in pool.executed)


def test_admin_cannot_deactivate_or_delete_themselves():
    pool = FakeAdminPool(existing="admin")
    client = build_client(pool)

    deactivate = client.patch("/api/admin/users/admin", headers=AUTH, json={"is_active": False})
    delete = client.delete("/api/admin/users/admin", headers=AUTH)

    assert deactivate.status_code == 400
    assert delete.status_code == 400
