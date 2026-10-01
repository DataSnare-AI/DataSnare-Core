CREATE TABLE IF NOT EXISTS core_storage_settings (
    singleton_id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
    backend TEXT NOT NULL DEFAULT 'local',
    local_upload_dir TEXT,
    upload_max_bytes BIGINT NOT NULL DEFAULT 262144000,
    blob_prefix TEXT NOT NULL DEFAULT 'core-artifacts',
    azure_container TEXT,
    azure_account_url TEXT,
    azure_connection_string_enc TEXT,
    azure_account_key_enc TEXT,
    azure_sas_token_enc TEXT,
    updated_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS core_artifacts (
    artifact_id TEXT PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES core_tenants(tenant_id) ON DELETE CASCADE,
    product_key TEXT NOT NULL REFERENCES core_products(product_key),
    job_id TEXT,
    artifact_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
    sha256 TEXT NOT NULL,
    storage_backend TEXT NOT NULL,
    storage_ref TEXT NOT NULL,
    uploaded_by TEXT NOT NULL,
    retention_until TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_core_artifacts_tenant_created
    ON core_artifacts (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_core_artifacts_product
    ON core_artifacts (tenant_id, product_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_core_artifacts_job
    ON core_artifacts (tenant_id, job_id)
    WHERE job_id IS NOT NULL;