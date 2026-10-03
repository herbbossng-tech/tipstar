\set ON_ERROR_STOP off

\echo '--- SECTION11 TEST 1: authenticated (non-admin) cannot read operational_jobs (expect 0 rows) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select job_id from public.operational_jobs;
rollback;

\echo '--- SECTION11 TEST 2: admin CAN read operational_jobs (expect 1 row) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444"}';
select job_id from public.operational_jobs;
rollback;

\echo '--- SECTION11 TEST 3: anon cannot read operational_jobs at all (expect ERROR) ---'
begin;
set local role anon;
select job_id from public.operational_jobs;
rollback;

\echo '--- SECTION11 TEST 4: authenticated (even admin) cannot INSERT a job directly (expect ERROR) — only the service-role-backed worker/API writes ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444"}';
insert into public.operational_jobs (job_type, payload_reference, max_attempts, idempotency_key, created_by)
values ('OPERATIONAL_HEALTH_CHECK', '{}'::jsonb, 3, 'rogue-job-key', '44444444-4444-4444-4444-444444444444');
rollback;

\echo '--- SECTION11 TEST 5: service_role CAN insert a job (expect INSERT 1) ---'
begin;
set local role service_role;
insert into public.operational_jobs (job_type, payload_reference, max_attempts, idempotency_key, created_by)
values ('PERFORMANCE_SNAPSHOT', '{}'::jsonb, 3, 'new-job-key', 'system');
rollback;

\echo '--- SECTION11 TEST 6: DB rejects a duplicate operational_jobs idempotency_key (expect ERROR unique_violation) ---'
begin;
insert into public.operational_jobs (job_type, payload_reference, max_attempts, idempotency_key, created_by)
values ('PERFORMANCE_SNAPSHOT', '{}'::jsonb, 3, 'dup-job-key-test', 'system');
insert into public.operational_jobs (job_type, payload_reference, max_attempts, idempotency_key, created_by)
values ('PERFORMANCE_SNAPSHOT', '{}'::jsonb, 3, 'dup-job-key-test', 'system');
rollback;

\echo '--- SECTION11 TEST 7: DB rejects a FAILED job with no completed_at mismatch — a SUCCEEDED job MUST carry completed_at (expect ERROR check constraint) ---'
begin;
insert into public.operational_jobs (job_type, status, payload_reference, max_attempts, idempotency_key, created_by, completed_at)
values ('PERFORMANCE_SNAPSHOT', 'SUCCEEDED', '{}'::jsonb, 3, 'bad-completed-at-key', 'system', null);
rollback;

\echo '--- SECTION11 TEST 8: claim_next_operational_job() atomically claims a QUEUED job and marks it RUNNING (expect one row, status=RUNNING, attempts=1) ---'
begin;
set local role service_role;
select status, attempts from public.claim_next_operational_job('OPERATIONAL_HEALTH_CHECK', now(), 600000);
rollback;

\echo '--- SECTION11 TEST 9: claim_next_operational_job() returns no row once nothing is eligible (expect 0 rows after the fixture job is already RUNNING and not stale) ---'
begin;
set local role service_role;
update public.operational_jobs set status = 'RUNNING', started_at = now() where job_id = 'f1000000-0000-0000-0000-000000000001';
select status from public.claim_next_operational_job('OPERATIONAL_HEALTH_CHECK', now(), 600000);
rollback;

\echo '--- SECTION11 TEST 10: claim_next_operational_job() reclaims a STALE RUNNING job past its lease (expect one row reclaimed) ---'
begin;
set local role service_role;
update public.operational_jobs set status = 'RUNNING', started_at = now() - interval '1 hour' where job_id = 'f1000000-0000-0000-0000-000000000001';
select status, attempts from public.claim_next_operational_job('OPERATIONAL_HEALTH_CHECK', now(), 600000);
rollback;

\echo '--- SECTION11 TEST 11: authenticated role cannot EXECUTE claim_next_operational_job at all (expect ERROR permission denied) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444"}';
select public.claim_next_operational_job('OPERATIONAL_HEALTH_CHECK', now(), 600000);
rollback;

\echo '--- SECTION11 TEST 12: authenticated (non-admin) cannot read weekly_reports (expect 0 rows) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select report_id from public.weekly_reports;
rollback;

\echo '--- SECTION11 TEST 13: admin CAN read weekly_reports (expect 1 row) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444"}';
select report_id from public.weekly_reports;
rollback;

\echo '--- SECTION11 TEST 14: authenticated (even admin) cannot INSERT a report directly (expect ERROR) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444"}';
insert into public.weekly_reports (period_start, period_end, ledger_mode, report_version, generated_by, report_payload, idempotency_key)
values ('2026-02-01T00:00:00Z', '2026-02-07T23:59:59Z', 'LIVE', 1, '44444444-4444-4444-4444-444444444444', '{}'::jsonb, 'rogue-report-key');
rollback;

\echo '--- SECTION11 TEST 15: service_role CAN insert a report (expect INSERT 1) ---'
begin;
set local role service_role;
insert into public.weekly_reports (period_start, period_end, ledger_mode, report_version, generated_by, report_payload, idempotency_key)
values ('2026-02-01T00:00:00Z', '2026-02-07T23:59:59Z', 'LIVE', 1, 'system', '{}'::jsonb, 'new-report-key');
rollback;

\echo '--- SECTION11 TEST 16: DB rejects a duplicate (period_start, period_end, ledger_mode, report_version) tuple — the versioning boundary (expect ERROR unique_violation) ---'
begin;
insert into public.weekly_reports (period_start, period_end, ledger_mode, report_version, generated_by, report_payload, idempotency_key)
values ('2026-01-01T00:00:00Z', '2026-01-07T23:59:59Z', 'LIVE', 1, 'system', '{}'::jsonb, 'dup-report-version-key');
rollback;

\echo '--- SECTION11 TEST 17: a second VERSION for the same period (report_version=2) with supersedes_report_id set is allowed (expect INSERT 1, then report_version=2 pointing back at version 1) — regeneration never overwrites the prior row ---'
begin;
insert into public.weekly_reports (period_start, period_end, ledger_mode, report_version, generated_by, report_payload, supersedes_report_id, superseded_reason, idempotency_key)
values ('2026-01-01T00:00:00Z', '2026-01-07T23:59:59Z', 'LIVE', 2, 'system', '{}'::jsonb, 'f2000000-0000-0000-0000-000000000001', 'source data corrected', 'dup-report-version-key-v2');
select report_version, supersedes_report_id from public.weekly_reports where idempotency_key = 'dup-report-version-key-v2';
-- The prior version-1 row is untouched (still exactly what the fixture inserted).
select report_version, supersedes_report_id from public.weekly_reports where report_id = 'f2000000-0000-0000-0000-000000000001';
rollback;

\echo '--- SECTION11 TEST 18: DB rejects supersedes_report_id set without superseded_reason (expect ERROR check constraint) ---'
begin;
insert into public.weekly_reports (period_start, period_end, ledger_mode, report_version, generated_by, report_payload, supersedes_report_id, superseded_reason, idempotency_key)
values ('2026-03-01T00:00:00Z', '2026-03-07T23:59:59Z', 'LIVE', 1, 'system', '{}'::jsonb, 'f2000000-0000-0000-0000-000000000001', null, 'bad-supersede-key');
rollback;

\echo '--- SECTION11 TEST 19: authenticated user cannot UPDATE a weekly report (expect ERROR) — immutability is enforced at the RLS layer too, not just app discipline ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444"}';
update public.weekly_reports set status = 'DRAFT' where report_id = 'f2000000-0000-0000-0000-000000000001';
rollback;
