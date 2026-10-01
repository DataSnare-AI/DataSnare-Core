-- Core-owned password setup / invitation tokens.
CREATE TABLE IF NOT EXISTS core_password_setup_tokens (
    token_hash TEXT PRIMARY KEY,
    username TEXT NOT NULL REFERENCES core_users(username) ON DELETE CASCADE,
    email TEXT,
    invited_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    consumed_by_ip TEXT
);

CREATE INDEX IF NOT EXISTS idx_core_password_setup_tokens_user
    ON core_password_setup_tokens (username, created_at DESC);
