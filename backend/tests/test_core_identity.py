import pathlib
import sys

import bcrypt
import pytest
from fastapi import HTTPException

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.security.core_identity import CoreIdentityProvider


class FakeIdentityPool:
    def __init__(self, *, user=None, membership=None):
        self.user = user
        self.membership = membership
        self.executed = []

    async def fetchrow(self, query, *args):
        if "FROM core_users" in query:
            return self.user
        if "FROM core_auth_sessions" in query:
            return self.user
        if "FROM core_tenant_memberships" in query:
            return self.membership
        return None

    async def execute(self, query, *args):
        self.executed.append((query, args))
        return "UPDATE 1"


@pytest.mark.asyncio
async def test_core_login_verifies_imported_bcrypt_hash_and_issues_opaque_session():
    password_hash = bcrypt.hashpw(b"correct horse battery staple", bcrypt.gensalt()).decode()
    pool = FakeIdentityPool(user={"username": "alice", "password_hash": password_hash, "display_name": "Alice", "global_role": "operator"})
    provider = CoreIdentityProvider(pool)

    result = await provider.login("alice", "correct horse battery staple")

    assert result["username"] == "alice"
    assert result["token"]
    assert result["token"] != password_hash
    assert any("core_auth_sessions" in query for query, _ in pool.executed)


@pytest.mark.asyncio
async def test_core_login_rejects_invalid_password_and_invite_pending_hash():
    pool = FakeIdentityPool(user={"username": "alice", "password_hash": "!invite-pending!", "global_role": "viewer"})
    provider = CoreIdentityProvider(pool)

    with pytest.raises(HTTPException) as error:
        await provider.login("alice", "any-password")

    assert error.value.status_code == 401


@pytest.mark.asyncio
async def test_core_resolver_enforces_membership_for_tenant():
    pool = FakeIdentityPool(
        user={"username": "alice", "global_role": "operator"},
        membership={"role_key": "tenant_admin"},
    )
    provider = CoreIdentityProvider(pool)

    actor = await provider.resolve_actor(23, authorization="Bearer valid-session")

    assert actor.actor_id == "alice"
    assert actor.tenant_id == 23
    assert actor.role == "tenant_admin"
