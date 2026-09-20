-- =============================================================================
-- TIPSTAR — DEVELOPMENT SEED DATA
-- =============================================================================
-- Local/dev only. Never run against production. Seeds reference data only —
-- no fake picks, results, or performance numbers (Section 27 / "No Hidden
-- Losses" — performance must always be derived from real settled picks).
-- =============================================================================

insert into subscription_plans (id, name, billing_period_days, price_cents, currency)
values
  (gen_random_uuid(), 'Monthly Premium', 30, 999, 'USD'),
  (gen_random_uuid(), 'Annual Premium', 365, 9999, 'USD')
on conflict do nothing;

insert into affiliate_partners (id, name, is_active)
values
  (gen_random_uuid(), 'Example Partner Sportsbook (placeholder)', true)
on conflict (name) do nothing;
