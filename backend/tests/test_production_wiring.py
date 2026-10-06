import pathlib
import sys


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import pytest
from fastapi.testclient import TestClient

from app import main as main_module
from app.main import create_app
from app.repositories.postgres_agent_manifests import PostgresAgentManifestRepository
from app.repositories.postgres_ingest_jobs import PostgresIngestJobRepository
from app.repositories.postgres_knowledge_items import PostgresKnowledgeItemRepository
from app.repositories.postgres_knowledge_graph import PostgresKnowledgeGraphRepository
from app.repositories.postgres_retrieval_audit import PostgresRetrievalAuditRepository
from app.repositories.postgres_partner_connections import PostgresPartnerConnectionRepository
from app.services.postgres_vector_store import PostgresVectorStore


def test_database_pool_selects_postgres_knowledge_services():
    database_pool = object()
    app = create_app(database_pool=database_pool, auth_provider=object())

    assert isinstance(app.state.ingest_jobs, PostgresIngestJobRepository)
    assert isinstance(app.state.knowledge_items, PostgresKnowledgeItemRepository)
    assert isinstance(app.state.vector_store, PostgresVectorStore)
    assert isinstance(app.state.agent_manifests, PostgresAgentManifestRepository)
    assert isinstance(app.state.knowledge_graph, PostgresKnowledgeGraphRepository)
    assert isinstance(app.state.retrieval_audit, PostgresRetrievalAuditRepository)
    assert isinstance(app.state.partner_connections, PostgresPartnerConnectionRepository)
    assert app.state.database_pool is database_pool
    assert app.state.auth_provider is not None
    assert app.state.product_accounts.pool is database_pool


def test_database_url_creates_and_closes_pool(monkeypatch: pytest.MonkeyPatch):
    class FakePool:
        closed = False

        async def close(self) -> None:
            self.closed = True

    pool = FakePool()

    async def create_pool(database_url: str, **options: object) -> FakePool:
        assert database_url == "postgresql://core:test@localhost/core"
        assert options["min_size"] == 2
        assert options["max_size"] == 6
        assert options["command_timeout"] == 30.0
        return pool

    monkeypatch.setenv("DATABASE_URL", "postgresql://core:test@localhost/core")
    monkeypatch.setenv("DB_POOL_MIN_SIZE", "2")
    monkeypatch.setenv("DB_POOL_MAX_SIZE", "6")
    monkeypatch.setenv("DB_COMMAND_TIMEOUT_SECONDS", "30")
    monkeypatch.setattr(main_module.asyncpg, "create_pool", create_pool)

    app = create_app()
    with TestClient(app):
        assert app.state.database_pool is pool
        assert isinstance(app.state.ingest_jobs, PostgresIngestJobRepository)
        assert isinstance(app.state.knowledge_items, PostgresKnowledgeItemRepository)
        assert isinstance(app.state.vector_store, PostgresVectorStore)
        assert isinstance(app.state.agent_manifests, PostgresAgentManifestRepository)
        assert isinstance(app.state.knowledge_graph, PostgresKnowledgeGraphRepository)
        assert isinstance(app.state.retrieval_audit, PostgresRetrievalAuditRepository)
        assert isinstance(app.state.partner_connections, PostgresPartnerConnectionRepository)
    assert pool.closed


def test_create_app_does_not_depend_on_aiops_auth_url(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AUTH_PROVIDER_URL", "https://auth.datasnare.example")

    app = create_app()

    assert app.state.auth_provider is None


@pytest.mark.asyncio
async def test_resolve_actor_uses_configured_auth_provider(monkeypatch: pytest.MonkeyPatch):
    class FakeProvider:
        async def resolve_actor(self, tenant_id: int, x_actor: str | None = None, x_role: str | None = None, *, request=None, authorization: str | None = None):
            assert tenant_id == 7
            assert authorization == "Bearer aiops-token"
            return type("Actor", (), {"actor_id": "aiops-user", "tenant_id": tenant_id, "role": "tenant_admin", "source": "single-auth-fabric"})()

    app = create_app(auth_provider=FakeProvider())
    actor = await main_module.resolve_actor(7, None, None, request=type("Req", (), {"app": app, "headers": {"authorization": "Bearer aiops-token"}})(), authorization="Bearer aiops-token")

    assert actor.actor_id == "aiops-user"
    assert actor.role == "tenant_admin"


def test_core_auth_routes_proxy_login_and_profile():
    class FakeProvider:
        async def login(self, username: str, password: str):
            assert (username, password) == ("alice", "secret")
            return {"actor": "alice", "token": "opaque-session", "username": "alice"}

        async def profile(self, authorization: str):
            assert authorization == "Bearer opaque-session"
            return {"username": "alice", "tenant_subscriptions": [{"plan_key": "growth"}]}

        async def logout(self, authorization: str):
            assert authorization == "Bearer opaque-session"
            return {"status": "logged_out"}

    client = TestClient(create_app(auth_provider=FakeProvider()))
    login = client.post("/api/auth/login", json={"username": "alice", "password": "secret"})
    profile = client.get("/api/auth/profile", headers={"Authorization": "Bearer opaque-session"})
    logout = client.post("/api/auth/logout", headers={"Authorization": "Bearer opaque-session"})

    assert login.status_code == 200
    assert login.json()["token"] == "opaque-session"
    assert profile.json()["account_source"] == "core-product-catalog"
    assert profile.json()["tenant_subscriptions"] == []
    assert logout.json()["status"] == "logged_out"


def test_production_does_not_accept_legacy_actor_headers(monkeypatch: pytest.MonkeyPatch):
    from fastapi import HTTPException

    monkeypatch.setenv("DATASNARE_ENV", "production")
    with pytest.raises(HTTPException) as error:
        import asyncio
        asyncio.run(main_module.resolve_actor(7, "spoofed", "platform_admin"))

    assert error.value.status_code == 503