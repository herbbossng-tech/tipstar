-- public.value_evaluations (Section 07 §8/§9/§10 — Value Engine / Fair
-- Odds / EV / Edge). The persisted form of @sport-os/football-engine's
-- `ValueAssessment`, exactly as `evaluateValue()` returns it — including
-- its OWN `decision`/`reasons`/`qualifies` fields, which reflect ONLY the
-- Value Engine's judgment (edge/EV/data-quality/model-agreement
-- thresholds). Risk is never applied here — see public.decisions below,
-- which is the separate, later record produced once `applyRiskRejection`
-- has run. "VALUE and RISK must remain separate outputs" (§21) holds at
-- the schema level too: this table has no risk_evaluation_id column at
-- all.
--
-- Append-only: one row per `evaluateValue()` call, never UPDATEd —
-- mirrors market_observations' immutability and the "historical decision
-- records never overwritten" rule (§35).

create table public.value_evaluations (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.fixtures(id) on delete cascade,
  market_type text not null,
  selection text not null,
  line numeric null,
  calibrated_probability numeric null check (calibrated_probability is null or (calibrated_probability > 0 and calibrated_probability <= 1)),
  market_odds numeric null check (market_odds is null or market_odds > 1),
  fair_odds numeric null check (fair_odds is null or fair_odds > 1),
  edge numeric null,
  expected_value numeric null,
  data_quality text null,
  odds_timestamp timestamptz null,
  model_version text null,
  calculation_version text not null,
  eligibility text not null,
  decision public.decision_outcome not null,
  reasons text[] not null default '{}',
  qualifies boolean not null,
  evaluated_at timestamptz not null,
  created_at timestamptz not null default now()
);

comment on table public.value_evaluations is
  'Append-only Value Engine outputs (Section 07). decision/reasons/qualifies here are the Value Engine''s OWN judgment only — never combined with risk. See public.decisions for the finalized, risk-aware outcome. Never UPDATEd.';

create index value_evaluations_lookup_idx on public.value_evaluations (fixture_id, market_type, selection, evaluated_at);
create index value_evaluations_decision_idx on public.value_evaluations (decision);

alter table public.value_evaluations enable row level security;
