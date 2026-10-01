-- Seed a starter tier for every suite product without inventing prices or limits.
INSERT INTO core_product_plans
    (product_key, plan_key, display_name, description, price_monthly, currency, entitlements, is_active)
VALUES
    ('ailogscope', 'starter', 'Starter', 'Starter plan; pricing and limits pending configuration.', NULL, 'USD', '{}'::jsonb, TRUE),
    ('aiperf', 'starter', 'Starter', 'Starter plan; pricing and limits pending configuration.', NULL, 'USD', '{}'::jsonb, TRUE),
    ('aiprocmon', 'starter', 'Starter', 'Starter plan; pricing and limits pending configuration.', NULL, 'USD', '{}'::jsonb, TRUE),
    ('airca', 'starter', 'Starter', 'Starter plan; pricing and limits pending configuration.', NULL, 'USD', '{}'::jsonb, TRUE),
    ('ainetscope', 'starter', 'Starter', 'Starter plan; pricing and limits pending configuration.', NULL, 'USD', '{}'::jsonb, TRUE)
ON CONFLICT (product_key, plan_key) DO NOTHING;