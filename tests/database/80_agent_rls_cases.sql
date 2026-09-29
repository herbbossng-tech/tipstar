\set ON_ERROR_STOP off

\echo '--- AGENT TEST 1: authenticated (non-admin) cannot read agent_invocations (expect 0 rows) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select id from public.agent_invocations;
rollback;

\echo '--- AGENT TEST 2: admin/owner CAN read agent_invocations (expect 1 row) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select id from public.agent_invocations;
rollback;

\echo '--- AGENT TEST 3: anon cannot read agent_invocations at all (expect ERROR) ---'
begin;
set local role anon;
select id from public.agent_invocations;
rollback;

\echo '--- AGENT TEST 4: authenticated user cannot INSERT an agent_invocations row (expect ERROR) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
insert into public.agent_invocations (id, agent_id, agent_type, agent_version, correlation_id, requested_by, side_effect_level, status, input_reference)
values ('f0000000-0000-0000-0000-000000000099', 'fake-agent', 'football_intelligence', '0.1.0', 'c0000000-0000-0000-0000-000000000099', '11111111-1111-1111-1111-111111111111', 'analysis', 'idle', 'fake-req');
rollback;

\echo '--- AGENT TEST 5: service_role CAN insert an agent_invocations row (the real orchestrator path; expect INSERT 1) ---'
begin;
set local role service_role;
insert into public.agent_invocations (id, agent_id, agent_type, agent_version, correlation_id, requested_by, side_effect_level, status, input_reference)
values ('f0000000-0000-0000-0000-000000000002', 'football-intelligence-agent', 'football_intelligence', '0.1.0', 'c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'analysis', 'idle', 'req-2');
rollback;

\echo '--- AGENT TEST 6: DB rejects a duplicate (agent_type, idempotency_key) pair for a real value (expect ERROR unique_violation) ---'
begin;
insert into public.agent_invocations (id, agent_id, agent_type, agent_version, correlation_id, requested_by, side_effect_level, status, input_reference, idempotency_key)
values ('f0000000-0000-0000-0000-000000000003', 'football-intelligence-agent', 'football_intelligence', '0.1.0', 'c0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'analysis', 'idle', 'req-3', 'dup-key-test');
insert into public.agent_invocations (id, agent_id, agent_type, agent_version, correlation_id, requested_by, side_effect_level, status, input_reference, idempotency_key)
values ('f0000000-0000-0000-0000-000000000004', 'football-intelligence-agent', 'football_intelligence', '0.1.0', 'c0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'analysis', 'idle', 'req-4', 'dup-key-test');
rollback;

\echo '--- AGENT TEST 7: the SAME idempotency_key is allowed again under a DIFFERENT agent_type (expect INSERT 1, proving the uniqueness is scoped per agent_type) ---'
begin;
insert into public.agent_invocations (id, agent_id, agent_type, agent_version, correlation_id, requested_by, side_effect_level, status, input_reference, idempotency_key)
values ('f0000000-0000-0000-0000-000000000005', 'football-intelligence-agent', 'football_intelligence', '0.1.0', 'c0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'analysis', 'idle', 'req-5', 'dup-key-test');
insert into public.agent_invocations (id, agent_id, agent_type, agent_version, correlation_id, requested_by, side_effect_level, status, input_reference, idempotency_key)
values ('f0000000-0000-0000-0000-000000000006', 'aviator-intelligence-agent', 'aviator_intelligence', '0.1.0', 'c0000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'analysis', 'idle', 'req-6', 'dup-key-test');
rollback;

\echo '--- AGENT TEST 8: DB rejects a FAILED invocation with no failure_code (expect ERROR, check constraint) ---'
begin;
insert into public.agent_invocations (id, agent_id, agent_type, agent_version, correlation_id, requested_by, side_effect_level, status, input_reference)
values ('f0000000-0000-0000-0000-000000000007', 'football-intelligence-agent', 'football_intelligence', '0.1.0', 'c0000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'analysis', 'failed', 'req-7');
rollback;

\echo '--- AGENT TEST 9: DB rejects a non-FAILED invocation that DOES carry a failure_code (expect ERROR, check constraint) ---'
begin;
insert into public.agent_invocations (id, agent_id, agent_type, agent_version, correlation_id, requested_by, side_effect_level, status, input_reference, failure_code, failure_disposition)
values ('f0000000-0000-0000-0000-000000000008', 'football-intelligence-agent', 'football_intelligence', '0.1.0', 'c0000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'analysis', 'idle', 'req-8', 'MODEL_ERROR', 'permanent_failure');
rollback;

\echo '--- AGENT TEST 10: a properly-shaped FAILED invocation (both failure fields present) is accepted (expect INSERT 1) ---'
begin;
set local role service_role;
insert into public.agent_invocations (id, agent_id, agent_type, agent_version, correlation_id, requested_by, side_effect_level, status, input_reference, failure_code, failure_disposition, failure_message)
values ('f0000000-0000-0000-0000-000000000009', 'football-intelligence-agent', 'football_intelligence', '0.1.0', 'c0000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'analysis', 'failed', 'req-9', 'MODEL_ERROR', 'permanent_failure', 'the ensemble produced an invalid distribution');
rollback;

\echo '--- AGENT TEST 11: authenticated (non-admin) cannot read agent_messages (expect 0 rows) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select id from public.agent_messages;
rollback;

\echo '--- AGENT TEST 12: admin/owner CAN read agent_messages (expect 1 row) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select id from public.agent_messages;
rollback;

\echo '--- AGENT TEST 13: anon cannot read agent_messages at all (expect ERROR) ---'
begin;
set local role anon;
select id from public.agent_messages;
rollback;

\echo '--- AGENT TEST 14: authenticated user cannot INSERT an agent_messages row (expect ERROR) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
insert into public.agent_messages (id, correlation_id, kind, message_type, schema_version, source_agent, target_agent, payload)
values ('ab000000-0000-0000-0000-000000000099', 'c0000000-0000-0000-0000-000000000099', 'command', 'REQUEST_EXECUTION', 1, 'system', 'football_automation', '{}');
rollback;

\echo '--- AGENT TEST 15: even an admin has NO access at all to agent_idempotency_claims — it is service_role-only (expect ERROR) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select agent_type from public.agent_idempotency_claims;
rollback;

\echo '--- AGENT TEST 16: anon has no access to agent_idempotency_claims at all (expect ERROR) ---'
begin;
set local role anon;
select agent_type from public.agent_idempotency_claims;
rollback;

\echo '--- AGENT TEST 17: DB rejects a duplicate (agent_type, idempotency_key) CLAIM in agent_idempotency_claims (expect ERROR unique_violation on its primary key) ---'
begin;
insert into public.agent_idempotency_claims (agent_type, idempotency_key, invocation_id) values ('football_automation', 'dup-claim-test', 'f0000000-0000-0000-0000-000000000001');
insert into public.agent_idempotency_claims (agent_type, idempotency_key, invocation_id) values ('football_automation', 'dup-claim-test', 'f0000000-0000-0000-0000-000000000002');
rollback;

\echo '--- AGENT TEST 18: service_role CAN insert an agent_idempotency_claims row (the real orchestrator path; expect INSERT 1) ---'
begin;
set local role service_role;
insert into public.agent_idempotency_claims (agent_type, idempotency_key, invocation_id) values ('settlement', 'settle-ticket-42', 'f0000000-0000-0000-0000-000000000001');
rollback;
