-- Section 11 (operations/jobs/reporting) test fixtures (superuser,
-- bypasses RLS). One QUEUED job and one FINALIZED weekly report.

insert into public.operational_jobs (job_id, job_type, status, payload_reference, scheduled_at, max_attempts, idempotency_key, created_by) values
  ('f1000000-0000-0000-0000-000000000001', 'OPERATIONAL_HEALTH_CHECK', 'QUEUED', '{}'::jsonb, now(), 3, 'fixture-job-1', 'system');

insert into public.weekly_reports (report_id, period_start, period_end, ledger_mode, report_version, status, generated_by, source_reference, report_payload, idempotency_key) values
  ('f2000000-0000-0000-0000-000000000001', '2026-01-01T00:00:00Z', '2026-01-07T23:59:59Z', 'LIVE', 1, 'FINALIZED', 'system', '{}'::jsonb, '{"ticketCounts":{"total":0}}'::jsonb, 'fixture-report-1');
