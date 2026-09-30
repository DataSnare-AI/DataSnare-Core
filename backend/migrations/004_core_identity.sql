-- Core-owned username/password identity and opaque bearer sessions.
CREATE TABLE IF NOT EXISTS core_users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    email TEXT,
    global_role TEXT NOT NULL DEFAULT 'viewer',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    source_system TEXT NOT NULL DEFAULT 'core',
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS core_auth_sessions (
    token_hash TEXT PRIMARY KEY,
    username TEXT NOT NULL REFERENCES core_users(username) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_core_auth_sessions_user
    ON core_auth_sessions (username, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_core_auth_sessions_active
    ON core_auth_sessions (expires_at)
    WHERE revoked_at IS NULL;