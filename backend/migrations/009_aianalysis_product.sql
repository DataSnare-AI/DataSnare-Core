-- Register the planned unified analysis product without changing existing tool entitlements.
INSERT INTO core_products (product_key, display_name, description, is_active)
VALUES (
    'aianalysis',
    'DataSnare AIAnalysis',
    'Unified analysis workspace for first-party and approved community analysis plugins.',
    FALSE
)
ON CONFLICT (product_key) DO NOTHING;

INSERT INTO core_product_plans
    (product_key, plan_key, display_name, description, price_monthly, currency, entitlements, is_active)
VALUES (
    'aianalysis',
    'starter',
    'Starter',
    'Starter plan; pricing, limits, and availability pending configuration.',
    NULL,
    'USD',
    '{}'::jsonb,
    FALSE
)
ON CONFLICT (product_key, plan_key) DO NOTHING;