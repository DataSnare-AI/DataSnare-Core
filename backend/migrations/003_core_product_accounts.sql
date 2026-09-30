-- Core-owned organization, product catalog, and entitlement records.
-- tenant_id preserves existing AIOps identifiers during the migration period.
CREATE TABLE IF NOT EXISTS core_tenants (
    tenant_id BIGINT PRIMARY KEY,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    source_system TEXT NOT NULL DEFAULT 'core',
    source_tenant_key TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_system, source_tenant_key)
);

CREATE TABLE IF NOT EXISTS core_tenant_memberships (
    tenant_id BIGINT NOT NULL REFERENCES core_tenants(tenant_id) ON DELETE CASCADE,
    identity_issuer TEXT NOT NULL,
    identity_subject TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    role_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, identity_issuer, identity_subject)
);

CREATE INDEX IF NOT EXISTS idx_core_tenant_memberships_actor
    ON core_tenant_memberships (identity_issuer, identity_subject, status);

CREATE TABLE IF NOT EXISTS core_products (
    product_key TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS core_product_plans (
    product_key TEXT NOT NULL REFERENCES core_products(product_key) ON DELETE CASCADE,
    plan_key TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    price_monthly NUMERIC(10, 2),
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    entitlements JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (product_key, plan_key)
);

CREATE TABLE IF NOT EXISTS core_tenant_product_entitlements (
    tenant_id BIGINT NOT NULL REFERENCES core_tenants(tenant_id) ON DELETE CASCADE,
    product_key TEXT NOT NULL,
    plan_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    effective_start_date DATE,
    effective_end_date DATE,
    limits_override JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_system TEXT NOT NULL DEFAULT 'core',
    source_record_key TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, product_key),
    FOREIGN KEY (product_key, plan_key)
        REFERENCES core_product_plans(product_key, plan_key)
);

CREATE INDEX IF NOT EXISTS idx_core_entitlements_status
    ON core_tenant_product_entitlements (tenant_id, status, effective_end_date);

INSERT INTO core_products (product_key, display_name, description)
VALUES
    ('aiops', 'DataSnare AIOps', 'Operational monitoring, investigation, and controlled remediation.'),
    ('ailogscope', 'DataSnare AILogScope', 'Normalize event logs and application evidence into explainable findings.'),
    ('aiperf', 'DataSnare AIPerf', 'Review Performance Monitor captures and identify resource pressure.'),
    ('aiprocmon', 'DataSnare AIProcMon', 'Trace process activity, failures, and slow operations.'),
    ('airca', 'DataSnare AIRootCause', 'Combine normalized evidence into an incident narrative and next actions.'),
    ('ainetscope', 'DataSnare AINetScope', 'Inspect packet captures, streams, and protocol-level behavior.')
ON CONFLICT (product_key) DO NOTHING;

INSERT INTO core_product_plans
    (product_key, plan_key, display_name, description, price_monthly, currency, entitlements)
VALUES
    ('aiops', 'starter', 'Starter', 'Entry tier for small tenants', 99.00, 'USD', '{"max_users":10,"max_systems":50}'::jsonb),
    ('aiops', 'growth', 'Growth', 'Mid tier for scaling tenants', 399.00, 'USD', '{"max_users":50,"max_systems":250}'::jsonb),
    ('aiops', 'enterprise', 'Enterprise', 'High-capacity tier for large organizations', 1499.00, 'USD', '{"max_users":200,"max_systems":2000}'::jsonb)
ON CONFLICT (product_key, plan_key) DO NOTHING;