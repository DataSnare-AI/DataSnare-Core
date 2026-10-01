import pathlib
import sys


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.migration_catalog import available_migrations


def test_rag_foundation_migration_is_available():
    migrations = available_migrations()

    assert [migration.name for migration in migrations] == [
        "001_rag_foundation.sql",
        "002_ingest_jobs.sql",
        "003_core_product_accounts.sql",
        "004_core_identity.sql",
        "005_core_password_setup.sql",
    ]
    rag_sql = migrations[0].read_text(encoding="utf-8")
    jobs_sql = migrations[1].read_text(encoding="utf-8")
    accounts_sql = migrations[2].read_text(encoding="utf-8")
    identity_sql = migrations[3].read_text(encoding="utf-8")
    setup_sql = migrations[4].read_text(encoding="utf-8")
    assert "knowledge_items" in rag_sql
    assert "knowledge_chunks" in rag_sql
    assert "retrieval_audit_events" in rag_sql
    assert "CREATE EXTENSION IF NOT EXISTS vector" in rag_sql
    assert "CREATE TABLE IF NOT EXISTS ingest_jobs" in jobs_sql
    assert "tenant_id, job_id" in jobs_sql
    assert "CREATE TABLE IF NOT EXISTS core_tenants" in accounts_sql
    assert "CREATE TABLE IF NOT EXISTS core_tenant_memberships" in accounts_sql
    assert "CREATE TABLE IF NOT EXISTS core_products" in accounts_sql
    assert "CREATE TABLE IF NOT EXISTS core_product_plans" in accounts_sql
    assert "CREATE TABLE IF NOT EXISTS core_tenant_product_entitlements" in accounts_sql
    assert "('aiops', 'DataSnare AIOps'" in accounts_sql
    assert "('airca', 'DataSnare AIRootCause'" in accounts_sql
    assert "CREATE TABLE IF NOT EXISTS core_users" in identity_sql
    assert "CREATE TABLE IF NOT EXISTS core_auth_sessions" in identity_sql
    assert "CREATE TABLE IF NOT EXISTS core_password_setup_tokens" in setup_sql