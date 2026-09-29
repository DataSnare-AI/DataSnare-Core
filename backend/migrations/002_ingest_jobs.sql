CREATE TABLE IF NOT EXISTS ingest_jobs (
    tenant_id BIGINT NOT NULL,
    job_id TEXT NOT NULL,
    tool_id TEXT NOT NULL,
    artifact_name TEXT NOT NULL,
    artifact_type TEXT NOT NULL,
    requested_by TEXT NOT NULL,
    schema TEXT NOT NULL DEFAULT 'datasnare-ingest/job-v1',
    state TEXT NOT NULL DEFAULT 'queued'
        CHECK (state IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    normalized_schema TEXT,
    native_conversion JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_ingest_jobs_tenant_created
    ON ingest_jobs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingest_jobs_tenant_state
    ON ingest_jobs (tenant_id, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingest_jobs_native_conversion
    ON ingest_jobs USING GIN (native_conversion);
