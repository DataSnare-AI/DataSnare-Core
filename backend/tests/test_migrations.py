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
        "006_product_starter_plans.sql",
        "007_core_tenant_account_details.sql",
        "008_core_artifact_storage.sql",
        "009_aianalysis_product.sql",
        "010_analysis_investigations.sql",
        "011_investigation_metadata.sql",
        "012_ninjaone_connections.sql",
    ]
    rag_sql = migrations[0].read_text(encoding="utf-8")
    jobs_sql = migrations[1].read_text(encoding="utf-8")
    accounts_sql = migrations[2].read_text(encoding="utf-8")
    identity_sql = migrations[3].read_text(encoding="utf-8")
    setup_sql = migrations[4].read_text(encoding="utf-8")
    plans_sql = migrations[5].read_text(encoding="utf-8")
    tenant_details_sql = migrations[6].read_text(encoding="utf-8")
    storage_sql = migrations[7].read_text(encoding="utf-8")
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
    for product_key in ("ailogscope", "aiperf", "aiprocmon", "airca", "ainetscope"):
        assert f"('{product_key}', 'starter'" in plans_sql
    assert "CREATE TABLE IF NOT EXISTS core_storage_settings" in storage_sql
    assert "CREATE TABLE IF NOT EXISTS core_artifacts" in storage_sql
    assert "ADD COLUMN IF NOT EXISTS billing_contact_email" in tenant_details_sql
    assert "ADD COLUMN IF NOT EXISTS contract_start_date" in tenant_details_sql
    analysis_sql = migrations[8].read_text(encoding="utf-8")
    investigation_sql = migrations[9].read_text(encoding="utf-8")
    ninjaone_sql = migrations[11].read_text(encoding="utf-8")
    assert "'aianalysis'" in analysis_sql
    assert "FALSE" in analysis_sql
    assert "ON CONFLICT (product_key) DO NOTHING" in analysis_sql
    assert "ON CONFLICT (product_key, plan_key) DO NOTHING" in analysis_sql
    assert "CREATE TABLE IF NOT EXISTS analysis_investigations" in investigation_sql
    assert "evidence JSONB NOT NULL" in investigation_sql
    assert "CREATE TABLE IF NOT EXISTS core_partner_connections" in ninjaone_sql
    assert "refresh_token_enc TEXT" in ninjaone_sql
    assert "CREATE TABLE IF NOT EXISTS ninjaone_oauth_states" in ninjaone_sql