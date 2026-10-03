-- public.weekly_reports (Section 11 §J-§O). One row per generated
-- report VERSION — insert-only, mirroring `settlements`'s own "never
-- UPDATEd; a correction is a new row" precedent (Section 08) rather
-- than a DB trigger: the service-role-backed
-- `SupabaseWeeklyReportsRepository` (packages/agents/src/db/
-- repositories.ts) never issues an UPDATE against this table at all,
-- and no authenticated-role write policy exists for it either (see the
-- RLS migration) — immutability is enforced by "nothing can write here
-- except one repository method, and that method only INSERTs."

create table public.weekly_reports (
  report_id uuid primary key default gen_random_uuid(),
  period_start timestamptz not null,
  period_end timestamptz not null,
  ledger_mode public.ledger_mode not null,
  report_version integer not null check (report_version >= 1),
  status public.weekly_report_status not null default 'FINALIZED',
  generated_at timestamptz not null default now(),
  -- A users.id, or 'system' for a scheduler-triggered generation — same
  -- non-FK convention as operational_jobs.created_by, for the same
  -- reason (never trusted as authorization proof by itself).
  generated_by text not null,
  -- References into the real source data this report was built from
  -- (e.g. the performance_ledger row ids it aggregated) — never a full
  -- duplicate of that data.
  source_reference jsonb not null default '{}'::jsonb,
  -- The normalized, typed WeeklyReport payload itself (ticket counts,
  -- P&L, ROI, drawdown, losing streak, breakdowns, Telegram publication
  -- summary, operational incidents — see WeeklyReport in
  -- @sport-os/agents). Validated against its TypeScript schema before
  -- insert; never sensitive (no secrets, no raw user PII beyond what
  -- the report model itself defines).
  report_payload jsonb not null,
  -- When this version was generated to replace an earlier one for the
  -- SAME (period, ledger_mode) — the lineage link §M requires ("preserve
  -- lineage... record the reason"), never a silent overwrite.
  supersedes_report_id uuid null references public.weekly_reports (report_id),
  superseded_reason text null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  check ((supersedes_report_id is null) = (superseded_reason is null))
);

comment on table public.weekly_reports is
  'One row per generated report VERSION (Section 11), insert-only. A regenerated report for the same period/ledger_mode is a NEW row with report_version incremented and supersedes_report_id set — the prior row is never touched.';

-- Idempotency (§M): a repeat generation request for the same period/
-- ledger_mode/version resolves to the SAME row, never a duplicate.
create unique index weekly_reports_idempotency_key_idx on public.weekly_reports (idempotency_key);
create unique index weekly_reports_period_version_idx on public.weekly_reports (period_start, period_end, ledger_mode, report_version);

create index weekly_reports_period_idx on public.weekly_reports (period_start, period_end);
create index weekly_reports_status_idx on public.weekly_reports (status);

alter table public.weekly_reports enable row level security;
