-- public.risk_evaluations (Section 07 §17-19 — Risk Engine / Global
-- Daily Risk Controller / Aviator Execution Modes). The persisted form of
-- @sport-os/risk-engine's `TicketRiskResult`, produced by either
-- `evaluateTicketRisk()` (ticket_id set — a football ticket's stake/
-- exposure/leg-count/data-quality/entitlement limits) or
-- `evaluateAviatorDailyRisk()` (ticket_id null — the shared
-- `GlobalDailyRiskController`'s daily target/stop-loss state, which is
-- never tied to a specific ticket).
--
-- Append-only: one row per risk evaluation call, never UPDATEd — "value
-- and risk remain separate outputs" (§21) is enforced by construction
-- (this table has no expected_value/edge/probability column at all; see
-- public.decisions for how a risk_evaluation is later COMBINED with a
-- value_evaluation into one finalized outcome, without ever mutating
-- either source row).

create table public.risk_evaluations (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid null references public.tickets(id) on delete cascade,
  risk_code text not null,
  reasons text[] not null default '{}',
  approved boolean not null,
  reason text not null,
  proposed_stake numeric null,
  projected_daily_stake numeric null,
  projected_daily_ticket_count integer null,
  policy_version text not null,
  evaluated_at timestamptz not null,
  created_at timestamptz not null default now()
);

comment on table public.risk_evaluations is
  'Append-only Risk Engine outputs (Section 07) — ticket-level (evaluateTicketRisk, ticket_id set) or Aviator daily-controller-level (evaluateAviatorDailyRisk, ticket_id null). Never UPDATEd.';

create index risk_evaluations_ticket_id_idx on public.risk_evaluations (ticket_id);
create index risk_evaluations_evaluated_at_idx on public.risk_evaluations (evaluated_at);

alter table public.risk_evaluations enable row level security;
