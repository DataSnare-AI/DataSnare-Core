-- Tenant-scoped saved investigations; evidence rows are bounded normalized snapshots.
CREATE TABLE IF NOT EXISTS analysis_investigations (
    investigation_id TEXT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'resolved', 'archived')),
    evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analysis_investigations_tenant_updated
    ON analysis_investigations (tenant_id, updated_at DESC);-- Tenant-scoped saved investigations; evidence rows are bounded normalized snapshots.
CREATE TABLE IF NOT EXISTS analysis_investigations (
    investigation_id TEXT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'resolved', 'archived')),
    evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analysis_investigations_tenant_created
    ON analysis_investigations (tenant_id, created_at DESC);