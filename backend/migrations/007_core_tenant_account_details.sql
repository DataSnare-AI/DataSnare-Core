ALTER TABLE core_tenants
    ADD COLUMN IF NOT EXISTS tenant_name TEXT,
    ADD COLUMN IF NOT EXISTS company_name TEXT,
    ADD COLUMN IF NOT EXISTS primary_address TEXT,
    ADD COLUMN IF NOT EXISTS phone TEXT,
    ADD COLUMN IF NOT EXISTS contact_email TEXT,
    ADD COLUMN IF NOT EXISTS primary_contact_name TEXT,
    ADD COLUMN IF NOT EXISTS billing_contact_name TEXT,
    ADD COLUMN IF NOT EXISTS billing_contact_email TEXT,
    ADD COLUMN IF NOT EXISTS max_users INTEGER NOT NULL DEFAULT 10,
    ADD COLUMN IF NOT EXISTS max_systems INTEGER NOT NULL DEFAULT 50,
    ADD COLUMN IF NOT EXISTS contract_start_date DATE,
    ADD COLUMN IF NOT EXISTS contract_end_date DATE,
    ADD COLUMN IF NOT EXISTS notes TEXT;

UPDATE core_tenants
SET tenant_name = COALESCE(tenant_name, display_name),
    company_name = COALESCE(company_name, display_name)
WHERE tenant_name IS NULL OR company_name IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_core_tenants_tenant_name
    ON core_tenants (lower(tenant_name))
    WHERE tenant_name IS NOT NULL;