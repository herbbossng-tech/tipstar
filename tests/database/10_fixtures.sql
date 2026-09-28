-- Test fixtures, inserted as the migration-running superuser (bypasses
-- RLS naturally as a superuser, matching how the local test setup
-- authors fixture data outside the RLS boundary being tested).

insert into public.users (id, telegram_user_id, first_name, role, status) values
  ('11111111-1111-1111-1111-111111111111', 1001, 'Alice', 'user', 'active'),
  ('22222222-2222-2222-2222-222222222222', 1002, 'Bob', 'user', 'active'),
  ('33333333-3333-3333-3333-333333333333', 1003, 'Olivia', 'owner', 'active'),
  ('44444444-4444-4444-4444-444444444444', 1004, 'Adam', 'admin', 'active'),
  ('55555555-5555-5555-5555-555555555555', 1005, 'Sam', 'user', 'suspended'),
  ('66666666-6666-6666-6666-666666666666', 1006, 'Olga', 'owner', 'active');

insert into public.licenses (id, user_id, license_key, plan, status, starts_at, expires_at) values
  ('a1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'KEY-ALICE-ACTIVE', 'pro', 'active', now() - interval '1 day', now() + interval '30 days'),
  ('a2222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'KEY-BOB-EXPIRED', 'pro', 'expired', now() - interval '60 days', now() - interval '1 day');

insert into public.license_entitlements (license_id, feature_key, enabled) values
  ('a1111111-1111-1111-1111-111111111111', 'football_analysis', true),
  ('a1111111-1111-1111-1111-111111111111', 'football_automation', false);

insert into public.license_limits (license_id, max_tickets_per_day) values
  ('a1111111-1111-1111-1111-111111111111', 10);

insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, outcome, request_id, metadata) values
  ('11111111-1111-1111-1111-111111111111', 'license_created', 'license', 'a1111111-1111-1111-1111-111111111111', 'success', 'req-1', '{}');
