\set ON_ERROR_STOP off

\echo '--- SECTION07 TEST 1: authenticated (non-admin) cannot read tickets (expect 0 rows) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select id from public.tickets;
rollback;

\echo '--- SECTION07 TEST 2: admin/owner CAN read tickets (expect 1 row) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select id from public.tickets;
rollback;

\echo '--- SECTION07 TEST 3: anon cannot read tickets at all (expect ERROR) ---'
begin;
set local role anon;
select id from public.tickets;
rollback;

\echo '--- SECTION07 TEST 4: authenticated user cannot INSERT a ticket (expect ERROR) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
insert into public.tickets (id, ticket_type, status, created_by)
values ('13000000-0000-0000-0000-000000000099', 'SINGLE', 'DRAFT', '11111111-1111-1111-1111-111111111111');
rollback;

\echo '--- SECTION07 TEST 5: service_role CAN insert a ticket (the real repository path; expect INSERT 1) ---'
begin;
set local role service_role;
insert into public.tickets (id, ticket_type, status, created_by)
values ('13000000-0000-0000-0000-000000000002', 'SINGLE', 'DRAFT', '11111111-1111-1111-1111-111111111111');
rollback;

\echo '--- SECTION07 TEST 6: DB rejects a duplicate ticket idempotency_key (expect ERROR unique_violation) ---'
begin;
insert into public.tickets (id, ticket_type, status, created_by, idempotency_key)
values ('13000000-0000-0000-0000-000000000003', 'SINGLE', 'DRAFT', '11111111-1111-1111-1111-111111111111', 'dup-ticket-key-test');
insert into public.tickets (id, ticket_type, status, created_by, idempotency_key)
values ('13000000-0000-0000-0000-000000000004', 'SINGLE', 'DRAFT', '11111111-1111-1111-1111-111111111111', 'dup-ticket-key-test');
rollback;

\echo '--- SECTION07 TEST 7: two DRAFT tickets with NO idempotency_key are both allowed (expect INSERT 1 twice — null never collides) ---'
begin;
insert into public.tickets (id, ticket_type, status, created_by) values ('13000000-0000-0000-0000-000000000005', 'SINGLE', 'DRAFT', '11111111-1111-1111-1111-111111111111');
insert into public.tickets (id, ticket_type, status, created_by) values ('13000000-0000-0000-0000-000000000006', 'SINGLE', 'DRAFT', '11111111-1111-1111-1111-111111111111');
rollback;

\echo '--- SECTION07 TEST 8: DB rejects a non-positive ticket stake (expect ERROR, check constraint) ---'
begin;
insert into public.tickets (id, ticket_type, status, created_by, stake) values ('13000000-0000-0000-0000-000000000007', 'SINGLE', 'AUTHORIZED', '11111111-1111-1111-1111-111111111111', 0);
rollback;

\echo '--- SECTION07 TEST 9: authenticated (non-admin) cannot read ticket_legs (expect 0 rows) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select id from public.ticket_legs;
rollback;

\echo '--- SECTION07 TEST 10: admin CAN read ticket_legs (expect 1 row) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select id from public.ticket_legs;
rollback;

\echo '--- SECTION07 TEST 11: DB rejects a ticket_legs row with an out-of-range probability (expect ERROR, check constraint) ---'
begin;
insert into public.ticket_legs (id, ticket_id, fixture_id, market_type, selection, probability, odds, calculation_version, value_evaluated_at)
values ('14000000-0000-0000-0000-000000000099', '13000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'match_result_1x2', 'HOME', 1.5, 2.0, 'value-engine-v1', now());
rollback;

\echo '--- SECTION07 TEST 12: DB rejects a ticket_legs row with odds <= 1 (expect ERROR, check constraint) ---'
begin;
insert into public.ticket_legs (id, ticket_id, fixture_id, market_type, selection, probability, odds, calculation_version, value_evaluated_at)
values ('14000000-0000-0000-0000-000000000098', '13000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'match_result_1x2', 'HOME', 0.5, 1.0, 'value-engine-v1', now());
rollback;

\echo '--- SECTION07 TEST 13: authenticated (non-admin) cannot read execution_requests (expect 0 rows) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select id from public.execution_requests;
rollback;

\echo '--- SECTION07 TEST 14: admin CAN read execution_requests (expect 1 row) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select id from public.execution_requests;
rollback;

\echo '--- SECTION07 TEST 15: anon cannot read execution_requests at all (expect ERROR) ---'
begin;
set local role anon;
select id from public.execution_requests;
rollback;

\echo '--- SECTION07 TEST 16: DB rejects a duplicate execution_requests idempotency_key — real idempotency enforcement (expect ERROR unique_violation) ---'
begin;
insert into public.execution_requests (id, ticket_id, ticket_or_signal_id, requested_by, execution_mode, stake, idempotency_key, gate_authorized)
values ('17000000-0000-0000-0000-000000000002', '13000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'automatic', 10, 'dup-exec-key-test', true);
insert into public.execution_requests (id, ticket_id, ticket_or_signal_id, requested_by, execution_mode, stake, idempotency_key, gate_authorized)
values ('17000000-0000-0000-0000-000000000003', '13000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'automatic', 10, 'dup-exec-key-test', true);
rollback;

\echo '--- SECTION07 TEST 17: a retried request with the SAME idempotency_key is rejected even on a SEPARATE (Aviator) ticket_or_signal_id — uniqueness is global, not scoped to one ticket (expect ERROR unique_violation) ---'
begin;
insert into public.execution_requests (id, ticket_id, ticket_or_signal_id, requested_by, execution_mode, stake, idempotency_key, gate_authorized)
values ('17000000-0000-0000-0000-000000000004', null, 'aviator-signal-1', '11111111-1111-1111-1111-111111111111', 'automatic', 10, 'dup-exec-key-cross-ticket', true);
insert into public.execution_requests (id, ticket_id, ticket_or_signal_id, requested_by, execution_mode, stake, idempotency_key, gate_authorized)
values ('17000000-0000-0000-0000-000000000005', '13000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'automatic', 10, 'dup-exec-key-cross-ticket', true);
rollback;

\echo '--- SECTION07 TEST 18: service_role CAN insert an execution_requests row (expect INSERT 1) ---'
begin;
set local role service_role;
insert into public.execution_requests (id, ticket_id, ticket_or_signal_id, requested_by, execution_mode, stake, idempotency_key, gate_authorized)
values ('17000000-0000-0000-0000-000000000006', '13000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'automatic', 10, 'service-role-exec-1', true);
rollback;

\echo '--- SECTION07 TEST 19: DB rejects a non-positive execution_requests stake (expect ERROR, check constraint) ---'
begin;
insert into public.execution_requests (id, ticket_id, ticket_or_signal_id, requested_by, execution_mode, stake, idempotency_key, gate_authorized)
values ('17000000-0000-0000-0000-000000000007', '13000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'manual', -5, 'invalid-stake-exec-1', false);
rollback;

\echo '--- SECTION07 TEST 20: authenticated (non-admin) cannot read execution_results (expect 0 rows) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select id from public.execution_results;
rollback;

\echo '--- SECTION07 TEST 21: admin CAN read execution_results (expect 1 row) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select id from public.execution_results;
rollback;

\echo '--- SECTION07 TEST 22: execution_results accepts a real EXECUTED row only as an explicit, distinct status value — never defaulted (expect INSERT 1) ---'
begin;
set local role service_role;
insert into public.execution_results (id, execution_request_id, status, external_reference, stake, executed_at)
values ('18000000-0000-0000-0000-000000000002', '17000000-0000-0000-0000-000000000001', 'EXECUTED', 'ext-ref-test-1', 10, now());
rollback;

\echo '--- SECTION07 TEST 23: DB rejects an execution_results row with an unrecognized status value (expect ERROR, invalid enum input) ---'
begin;
insert into public.execution_results (id, execution_request_id, status)
values ('18000000-0000-0000-0000-000000000003', '17000000-0000-0000-0000-000000000001', 'GUARANTEED_WIN');
rollback;

\echo '--- SECTION07 TEST 24: authenticated (non-admin) cannot read risk_evaluations (expect 0 rows) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select id from public.risk_evaluations;
rollback;

\echo '--- SECTION07 TEST 25: admin CAN read risk_evaluations (expect 1 row) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select id from public.risk_evaluations;
rollback;

\echo '--- SECTION07 TEST 26: authenticated (non-admin) cannot read value_evaluations (expect 0 rows) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select id from public.value_evaluations;
rollback;

\echo '--- SECTION07 TEST 27: admin CAN read value_evaluations (expect 1 row) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select id from public.value_evaluations;
rollback;

\echo '--- SECTION07 TEST 28: DB rejects a value_evaluations row with an out-of-range calibrated_probability (expect ERROR, check constraint) ---'
begin;
insert into public.value_evaluations (id, fixture_id, market_type, selection, calibrated_probability, calculation_version, eligibility, decision, qualifies, evaluated_at)
values ('12000000-0000-0000-0000-000000000099', 'f1000000-0000-0000-0000-000000000001', 'match_result_1x2', 'HOME', 1.2, 'value-engine-v1', 'valid', 'BET', true, now());
rollback;

\echo '--- SECTION07 TEST 29: authenticated (non-admin) cannot read decisions (expect 0 rows) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select id from public.decisions;
rollback;

\echo '--- SECTION07 TEST 30: admin CAN read decisions (expect 1 row) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select id from public.decisions;
rollback;

\echo '--- SECTION07 TEST 31: authenticated (non-admin) cannot read market_observations (expect 0 rows) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select id from public.market_observations;
rollback;

\echo '--- SECTION07 TEST 32: admin CAN read market_observations (expect 1 row) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select id from public.market_observations;
rollback;

\echo '--- SECTION07 TEST 33: DB rejects a market_observations row with non-positive odds (expect ERROR, check constraint) ---'
begin;
insert into public.market_observations (id, fixture_id, market_type, selection, odds, odds_timestamp, source)
values ('11000000-0000-0000-0000-000000000099', 'f1000000-0000-0000-0000-000000000001', 'match_result_1x2', 'HOME', 1.0, now(), 'test_bookmaker');
rollback;

\echo '--- SECTION07 TEST 34: DB rejects a ticket_status_history row that repeats an existing (ticket_id, version) pair — versions are append-only and unique (expect ERROR unique_violation) ---'
begin;
insert into public.ticket_status_history (ticket_id, version, status, transitioned_at)
values ('13000000-0000-0000-0000-000000000001', 1, 'PROPOSED', now());
rollback;

\echo '--- SECTION07 TEST 35: a NEW version for the same ticket is accepted — proves append-only versioning works, not just uniqueness (expect INSERT 1) ---'
begin;
insert into public.ticket_status_history (ticket_id, version, status, transitioned_at)
values ('13000000-0000-0000-0000-000000000001', 2, 'PROPOSED', now());
rollback;

\echo '--- SECTION07 TEST 36: even an admin has NO write access to any Section 07 table — only service_role writes (expect ERROR) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
insert into public.tickets (id, ticket_type, status, created_by)
values ('13000000-0000-0000-0000-000000000098', 'SINGLE', 'DRAFT', '11111111-1111-1111-1111-111111111111');
rollback;
