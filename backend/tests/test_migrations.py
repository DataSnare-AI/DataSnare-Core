import pathlib
import sys


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.migration_catalog import available_migrations


def test_rag_foundation_migration_is_available():
    migrations = available_migrations()

    assert [migration.name for migration in migrations] == ["001_rag_foundation.sql", "002_ingest_jobs.sql"]
    rag_sql = migrations[0].read_text(encoding="utf-8")
    jobs_sql = migrations[1].read_text(encoding="utf-8")
    assert "knowledge_items" in rag_sql
    assert "knowledge_chunks" in rag_sql
    assert "retrieval_audit_events" in rag_sql
    assert "CREATE EXTENSION IF NOT EXISTS vector" in rag_sql
    assert "CREATE TABLE IF NOT EXISTS ingest_jobs" in jobs_sql
    assert "tenant_id, job_id" in jobs_sql