CREATE TABLE IF NOT EXISTS core_partner_connections (
    tenant_id BIGINT NOT NULL REFERENCES core_tenants(tenant_id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    base_url TEXT NOT NULL,
    client_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
    client_secret_enc TEXT NOT NULL,
    refresh_token_enc TEXT,
    connected BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, provider)
);

CREATE TABLE IF NOT EXISTS ninjaone_oauth_states (
    state_hash CHAR(64) PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES core_tenants(tenant_id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ninjaone_oauth_states_expiry
    ON ninjaone_oauth_states (expires_at);