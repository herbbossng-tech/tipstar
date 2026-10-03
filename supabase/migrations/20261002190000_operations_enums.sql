-- Section 11 — Automation Operations + Licensing Administration +
-- Reporting. Enum types mirroring @sport-os/platform's own TypeScript
-- `as const` unions exactly (defense-in-depth mirror, same rationale as
-- every prior section's own enums file):
--   JobStatus           packages/platform/src/operations/jobs.ts
--   OperationalJobType  packages/platform/src/operations/jobs.ts
--   JobFailureCategory  packages/platform/src/operations/jobs.ts
--   (weekly report status is new, below)
--
-- public.ledger_mode (Section 08, PAPER/LIVE) is reused directly for
-- weekly_reports.ledger_mode below — never duplicated into a
-- near-identical new enum.

create type public.operational_job_status as enum ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

create type public.operational_job_type as enum ('WEEKLY_REPORT_GENERATION', 'TELEGRAM_REPORT_PUBLICATION', 'PERFORMANCE_SNAPSHOT', 'OPERATIONAL_HEALTH_CHECK');

create type public.job_failure_category as enum (
  'DATA_UNAVAILABLE', 'TIMEOUT', 'INTEGRATION_UNAVAILABLE', 'TRANSIENT_DEPENDENCY_FAILURE',
  'AUTHORIZATION_DENIED', 'INVALID_PAYLOAD', 'INVALID_STATE_TRANSITION', 'POLICY_REJECTED',
  'LICENSE_DENIED', 'PERMANENT_INTEGRATION_ERROR', 'UNKNOWN'
);

-- Deliberately two values only: a report is either still being written
-- (DRAFT, during its one generation job) or FINALIZED (immutable from
-- that point on). A regenerated report is a NEW row with an incremented
-- report_version — never a third "superseded" status on the old row,
-- which stays FINALIZED forever; see weekly_reports.sql's lineage
-- columns for how the newer version is linked back to it.
create type public.weekly_report_status as enum ('DRAFT', 'FINALIZED');
