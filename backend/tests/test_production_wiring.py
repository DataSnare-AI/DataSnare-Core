import pathlib
import sys


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

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