\set ON_ERROR_STOP off

\echo '--- SECTION08 TEST 1: authenticated (non-admin) cannot read settlements (expect 0 rows) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select id from public.settlements;
rollback;

\echo '--- SECTION08 TEST 2: admin/owner CAN read settlements (expect 1 row) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select id from public.settlements;
rollback;

\echo '--- SECTION08 TEST 3: anon cannot read settlements at all (expect ERROR) ---'
begin;
set local role anon;
select id from public.settlements;
rollback;

\echo '--- SECTION08 TEST 4: authenticated user cannot INSERT a settlement (expect ERROR) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
insert into public.settlements (id, ticket_id, ticket_version, status, settlement_policy_version, ledger_mode, source)
values ('1a000000-0000-0000-0000-000000000099', '13000000-0000-0000-0000-000000000001', 1, 'WON', 'football-settlement-v1', 'LIVE', 'test');
rollback;

\echo '--- SECTION08 TEST 5: service_role CAN insert a settlement (the real repository path; expect INSERT 1) ---'
begin;
set local role service_role;
insert into public.settlements (id, ticket_id, ticket_version, status, settlement_policy_version, ledger_mode, source)
values ('1a000000-0000-0000-0000-000000000002', '13000000-0000-0000-0000-000000000001', 1, 'WON', 'other-policy-v1', 'LIVE', 'test');
rollback;

\echo '--- SECTION08 TEST 6: DB rejects a duplicate (ticket_id, ticket_version, settlement_policy_version) — idempotent settlement (§40) (expect ERROR unique_violation) ---'
begin;
insert into public.settlements (id, ticket_id, ticket_version, status, settlement_policy_version, ledger_mode, source)
values ('1a000000-0000-0000-0000-000000000003', '13000000-0000-0000-0000-000000000001', 1, 'WON', 'football-settlement-v1', 'LIVE', 'test');
rollback;

\echo '--- SECTION08 TEST 7: a DIFFERENT settlement_policy_version for the SAME ticket is allowed (expect INSERT 1, proving the uniqueness is scoped, not overbroad) ---'
begin;
insert into public.settlements (id, ticket_id, ticket_version, status, settlement_policy_version, ledger_mode, source)
values ('1a000000-0000-0000-0000-000000000004', '13000000-0000-0000-0000-000000000001', 1, 'WON', 'football-settlement-v2', 'LIVE', 'test');
rollback;

\echo '--- SECTION08 TEST 8: DB rejects an actual_payout with payout_source != PROVIDER — a CALCULATED figure may never masquerade as actual (§12/§16) (expect ERROR, check constraint) ---'
begin;
insert into public.settlements (id, ticket_id, ticket_version, status, settlement_policy_version, ledger_mode, source, actual_payout_amount, actual_payout_currency, payout_source)
values ('1a000000-0000-0000-0000-000000000005', '13000000-0000-0000-0000-000000000001', 1, 'WON', 'football-settlement-v3', 'LIVE', 'test', 100, 'NGN', 'CALCULATED');
rollback;

\echo '--- SECTION08 TEST 9: DB rejects a money field with an amount but no currency, or vice versa (§44) (expect ERROR, check constraint) ---'
begin;
insert into public.settlements (id, ticket_id, ticket_version, status, settlement_policy_version, ledger_mode, source, actual_stake_amount, actual_stake_currency)
values ('1a000000-0000-0000-0000-000000000006', '13000000-0000-0000-0000-000000000001', 1, 'WON', 'football-settlement-v4', 'LIVE', 'test', 100, null);
rollback;

\echo '--- SECTION08 TEST 10: authenticated (non-admin) cannot read settlement_legs (expect 0 rows) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select id from public.settlement_legs;
rollback;

\echo '--- SECTION08 TEST 11: admin CAN read settlement_legs (expect 1 row) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select id from public.settlement_legs;
rollback;

\echo '--- SECTION08 TEST 12: anon cannot read settlement_legs at all (expect ERROR) ---'
begin;
set local role anon;
select id from public.settlement_legs;
rollback;

\echo '--- SECTION08 TEST 13: DB rejects a settlement_legs row with a non-PENDING status and no result_version_id (§7/§8) (expect ERROR, check constraint) ---'
begin;
insert into public.settlement_legs (id, settlement_id, leg_id, fixture_id, market_type, selection, odds, status, result_version_id, reason)
values ('1b000000-0000-0000-0000-000000000099', '1a000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'match_result_1x2', 'HOME', 2.0, 'WON', null, 'missing result version');
rollback;

\echo '--- SECTION08 TEST 14: a PENDING settlement_legs row with no result_version_id is accepted (expect INSERT 1) ---'
begin;
insert into public.settlement_legs (id, settlement_id, leg_id, fixture_id, market_type, selection, odds, status, result_version_id, reason)
values ('1b000000-0000-0000-0000-000000000098', '1a000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'match_result_1x2', 'HOME', 2.0, 'PENDING', null, 'no result yet');
rollback;

\echo '--- SECTION08 TEST 15: authenticated (non-admin) cannot read settlement_revisions (expect 0 rows) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select id from public.settlement_revisions;
rollback;

\echo '--- SECTION08 TEST 16: admin CAN read settlement_revisions (expect 1 row) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select id from public.settlement_revisions;
rollback;

\echo '--- SECTION08 TEST 17: DB rejects a duplicate settlement_revisions idempotency_key — same correction submitted twice (§41 adversarial #12) (expect ERROR unique_violation) ---'
begin;
insert into public.settlement_revisions (id, original_settlement_id, previous_status, new_status, reason, source, idempotency_key, created_by)
values ('1c000000-0000-0000-0000-000000000002', '1a000000-0000-0000-0000-000000000001', 'WON', 'VOID', 'match abandoned', 'test', 'dup-revision-key-test', 'system');
insert into public.settlement_revisions (id, original_settlement_id, previous_status, new_status, reason, source, idempotency_key, created_by)
values ('1c000000-0000-0000-0000-000000000003', '1a000000-0000-0000-0000-000000000001', 'WON', 'VOID', 'match abandoned (repeat submission)', 'test', 'dup-revision-key-test', 'system');
rollback;

\echo '--- SECTION08 TEST 18: two DIFFERENT revisions for the SAME original settlement are both allowed — multiple corrections are expected and fully preserved (§9) (expect INSERT 1 twice) ---'
begin;
insert into public.settlement_revisions (id, original_settlement_id, previous_status, new_status, reason, source, idempotency_key, created_by)
values ('1c000000-0000-0000-0000-000000000004', '1a000000-0000-0000-0000-000000000001', 'WON', 'LOST', 'first correction', 'test', 'revision-key-a', 'system');
insert into public.settlement_revisions (id, original_settlement_id, previous_status, new_status, reason, source, idempotency_key, created_by)
values ('1c000000-0000-0000-0000-000000000005', '1a000000-0000-0000-0000-000000000001', 'LOST', 'WON', 'second correction reverses the first', 'test', 'revision-key-b', 'system');
rollback;

\echo '--- SECTION08 TEST 19: even an admin has NO write access to settlements/settlement_revisions — only service_role writes (expect ERROR) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
insert into public.settlement_revisions (id, original_settlement_id, previous_status, new_status, reason, source, created_by)
values ('1c000000-0000-0000-0000-000000000099', '1a000000-0000-0000-0000-000000000001', 'WON', 'VOID', 'admin attempt', 'test', 'admin');
rollback;

\echo '--- SECTION08 TEST 20: authenticated (non-admin) cannot read performance_ledger (expect 0 rows) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select id from public.performance_ledger;
rollback;

\echo '--- SECTION08 TEST 21: admin CAN read performance_ledger (expect 1 row) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select id from public.performance_ledger;
rollback;

\echo '--- SECTION08 TEST 22: DB rejects a duplicate performance_ledger row under the identical dimension tuple (expect ERROR unique_violation) ---'
begin;
insert into public.performance_ledger (period_start, period_end, ledger_mode, sport, league, market, model_version, decision_policy_version, ticket_type, ticket_count, leg_count, executed_ticket_count, settled_ticket_count, wins, losses, voids, pushes, pending, sample_size)
values ('2026-01-01T00:00:00Z', '2026-01-31T23:59:59Z', 'LIVE', 'football', 'Premier League', 'match_result_1x2', 'test-model-v1', 'policy-test-v1', 'SINGLE', 1, 1, 1, 1, 1, 0, 0, 0, 0, 1);
rollback;

\echo '--- SECTION08 TEST 23: DB rejects a negative sample_size / count on performance_ledger (expect ERROR, check constraint) ---'
begin;
insert into public.performance_ledger (period_start, period_end, ledger_mode, sport, ticket_count, leg_count, executed_ticket_count, settled_ticket_count, wins, losses, voids, pushes, pending, sample_size)
values ('2026-02-01T00:00:00Z', '2026-02-28T23:59:59Z', 'LIVE', 'football', -1, 0, 0, 0, 0, 0, 0, 0, 0, 0);
rollback;

\echo '--- SECTION08 TEST 24: authenticated (non-admin) cannot read backtest_runs/backtest_results (expect 0 rows) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select id from public.backtest_runs;
select id from public.backtest_results;
rollback;

\echo '--- SECTION08 TEST 25: admin CAN read backtest_runs/backtest_results (expect 1 row each) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select id from public.backtest_runs;
select id from public.backtest_results;
rollback;

\echo '--- SECTION08 TEST 26: anon cannot read backtest_runs at all (expect ERROR) ---'
begin;
set local role anon;
select id from public.backtest_runs;
rollback;

\echo '--- SECTION08 TEST 27: DB rejects a non-positive stake_per_ticket on backtest_runs — never an invented/free stake (expect ERROR, check constraint) ---'
begin;
insert into public.backtest_runs (id, decision_policy_version, settlement_policy_version, stake_per_ticket, currency)
values ('1e000000-0000-0000-0000-000000000099', 'policy-test-v1', 'football-settlement-v1', 0, 'NGN');
rollback;

\echo '--- SECTION08 TEST 28: service_role CAN insert a full backtest_runs + backtest_results pair (the real backtest pipeline; expect INSERT 1 twice) ---'
begin;
set local role service_role;
insert into public.backtest_runs (id, decision_policy_version, settlement_policy_version, stake_per_ticket, currency, status)
values ('1e000000-0000-0000-0000-000000000002', 'policy-test-v1', 'football-settlement-v1', 10, 'NGN', 'completed');
insert into public.backtest_results (id, backtest_run_id, sample_count, accuracy)
values ('1f000000-0000-0000-0000-000000000002', '1e000000-0000-0000-0000-000000000002', 50, 0.6);
rollback;
