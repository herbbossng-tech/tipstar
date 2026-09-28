-- Section 03 RLS test suite. Each test runs in its own transaction
-- (BEGIN...ROLLBACK) so mutations never persist and a permission error
-- in one test cannot abort the rest of the run. Read the transcript this
-- produces: each \echo label states the expected outcome; verify the
-- SQL result immediately beneath it matches.

\set ON_ERROR_STOP off

\echo '--- TEST 1: User A can read own profile (expect 1 row: Alice) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select id, first_name from public.users where id = '11111111-1111-1111-1111-111111111111';
rollback;

\echo '--- TEST 2: User A cannot read User B profile (expect 0 rows) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select id, first_name from public.users where id = '22222222-2222-2222-2222-222222222222';
rollback;

\echo '--- TEST 3: User A cannot modify User B (expect UPDATE 0) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
update public.users set first_name = 'Hacked' where id = '22222222-2222-2222-2222-222222222222';
rollback;

\echo '--- TEST 4: User A cannot change own role (expect ERROR) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
update public.users set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';
rollback;

\echo '--- TEST 5: User A cannot change own status (expect ERROR) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
update public.users set status = 'suspended' where id = '11111111-1111-1111-1111-111111111111';
rollback;

\echo '--- TEST 6: User A cannot modify own license (expect UPDATE 0) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
update public.licenses set plan = 'ultra' where user_id = '11111111-1111-1111-1111-111111111111';
rollback;

\echo '--- TEST 7: User A cannot modify own entitlement (expect UPDATE 0) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
update public.license_entitlements set enabled = true where license_id = 'a1111111-1111-1111-1111-111111111111' and feature_key = 'football_automation';
rollback;

\echo '--- TEST 8: User A cannot modify own limits (expect UPDATE 0) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
update public.license_limits set max_tickets_per_day = 999 where license_id = 'a1111111-1111-1111-1111-111111111111';
rollback;

\echo '--- TEST 9: User cannot read raw license_key, even on own row (expect ERROR) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select license_key from public.licenses where id = 'a1111111-1111-1111-1111-111111111111';
rollback;

\echo '--- TEST 10: User cannot insert an OWNER (expect ERROR) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
insert into public.users (telegram_user_id, first_name, role) values (9999, 'Evil', 'owner');
rollback;

\echo '--- TEST 11: User cannot promote themselves to owner (expect ERROR) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
update public.users set role = 'owner' where id = '11111111-1111-1111-1111-111111111111';
rollback;

\echo '--- TEST 12: ADMIN cannot promote another user to OWNER (expect ERROR) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444"}';
update public.users set role = 'owner' where id = '22222222-2222-2222-2222-222222222222';
rollback;

\echo '--- TEST 13a: ADMIN cannot demote an OWNER (expect ERROR) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444"}';
update public.users set role = 'admin' where id = '33333333-3333-3333-3333-333333333333';
rollback;

\echo '--- TEST 13b: ADMIN CAN suspend an ordinary user (bounded authority; expect UPDATE 1) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444"}';
update public.users set status = 'suspended' where id = '22222222-2222-2222-2222-222222222222';
rollback;

\echo '--- TEST 14a: OWNER can promote a user to ADMIN (expect UPDATE 1) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
update public.users set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';
rollback;

\echo '--- TEST 14b: OWNER can manage a license (expect UPDATE 1) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
update public.licenses set plan = 'enterprise' where id = 'a1111111-1111-1111-1111-111111111111';
rollback;

\echo '--- TEST 15: Suspended user can still read their OWN profile via RLS (application layer denies protected access separately — see LICENSE/entitlement TS unit tests; expect 1 row) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555"}';
select id, status from public.users where id = '55555555-5555-5555-5555-555555555555';
rollback;

\echo '--- TEST 16-19: license validity / entitlement-enabled semantics are pure application logic (isLicenseActive/hasEntitlement) — covered by TS unit tests in packages/platform, not RLS. Skipped here by design. ---'

\echo '--- TEST 20: Historical (expired) license remains visible/auditable to admin (expect 1 row, status=expired) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select id, status from public.licenses where user_id = '22222222-2222-2222-2222-222222222222';
rollback;

\echo '--- TEST 21a: Ordinary USER cannot UPDATE audit_logs (expect ERROR) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
update public.audit_logs set outcome = 'failure' where actor_user_id = '11111111-1111-1111-1111-111111111111';
rollback;

\echo '--- TEST 21b: Ordinary USER cannot INSERT audit_logs (expect ERROR) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
insert into public.audit_logs (action, resource_type, outcome) values ('fake_event', 'user', 'success');
rollback;

\echo '--- TEST 22a: anon has no access to users at all (expect ERROR) ---'
begin;
set local role anon;
select * from public.users;
rollback;

\echo '--- TEST 22b: anon has no access to platform_settings (expect ERROR) ---'
begin;
set local role anon;
select * from public.platform_settings;
rollback;

\echo '--- TEST 22c: authenticated (even admin) has no access to platform_settings (expect ERROR) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select * from public.platform_settings;
rollback;

\echo '--- TEST 22d: service_role CAN access platform_settings (expect 1 row) ---'
begin;
set local role service_role;
select * from public.platform_settings;
rollback;

\echo '--- TEST 22e: service_role CAN insert audit_logs (the real production path; expect INSERT 1) ---'
begin;
set local role service_role;
insert into public.audit_logs (actor_user_id, action, resource_type, outcome) values ('11111111-1111-1111-1111-111111111111', 'test_event', 'user', 'success');
rollback;

\echo '--- BONUS: DB-level enforcement of "only one active/trial license per user" (expect ERROR unique_violation) ---'
begin;
insert into public.licenses (user_id, license_key, plan, status, starts_at) values ('11111111-1111-1111-1111-111111111111', 'KEY-ALICE-2', 'pro', 'trial', now());
rollback;

\echo '--- BONUS: updated_at is not client-writable at all via the authenticated role (expect ERROR, column privilege denied) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
update public.users set first_name = 'Alicia', updated_at = '1999-01-01' where id = '11111111-1111-1111-1111-111111111111';
rollback;

\echo '--- BONUS: updated_at IS server-maintained on a legitimate self-update (expect updated_at > 2020-01-01, i.e. now()) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
update public.users set first_name = 'Alicia' where id = '11111111-1111-1111-1111-111111111111';
select first_name, updated_at > '2020-01-01'::timestamptz as updated_at_is_recent from public.users where id = '11111111-1111-1111-1111-111111111111';
rollback;
