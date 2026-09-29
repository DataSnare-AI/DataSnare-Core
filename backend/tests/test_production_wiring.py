import pathlib
import sys


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import pytest
from fastapi.testclient import TestClient

from app import main as main_module
from app.main import create_app
from app.repositories.postgres_ingest_jobs import PostgresIngestJobRepository
from app.repositories.postgres_knowledge_items import PostgresKnowledgeItemRepository
from app.services.postgres_vector_store import PostgresVectorStore


def test_database_pool_selects_postgres_knowledge_services():
    database_pool = object()
    app = create_app(database_pool=database_pool, auth_provider=object())

    assert isinstance(app.state.ingest_jobs, PostgresIngestJobRepository)
    assert isinstance(app.state.knowledge_items, PostgresKnowledgeItemRepository)
    assert isinstance(app.state.vector_store, PostgresVectorStore)
    assert app.state.database_pool is database_pool
    assert app.state.auth_provider is not None


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
    assert pool.closed