import pathlib
import sys


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.migration_catalog import available_migrations


def test_rag_foundation_migration_is_available():
    migrations = available_migrations()

    assert [migration.name for migration in migrations] == ["001_rag_foundation.sql"]
    sql = migrations[0].read_text(encoding="utf-8")
    assert "knowledge_items" in sql
    assert "knowledge_chunks" in sql
    assert "retrieval_audit_events" in sql
    assert "CREATE EXTENSION IF NOT EXISTS vector" in sql