-- public.intelligence_ensemble_versions (Section 05 — Ensemble Engine).
-- "Do NOT hard-code arbitrary weights... Weights must either be
-- explicitly configured as a baseline experiment, or be learned...
-- Record ensemble version and component model versions."

create table public.intelligence_ensemble_versions (
  id uuid primary key default gen_random_uuid(),
  ensemble_version text not null unique,
  weight_source public.ensemble_weight_source not null,
  -- { componentName: weight, ... } — always sums to 1 (enforced at the
  -- application layer by ensemble.ts's combineEnsemble/
  -- learnEnsembleWeights, not re-validated in SQL).
  weights jsonb not null,
  -- { componentName: modelVersion, ... } — which trained artifact each
  -- named component actually was, at fit/configuration time.
  component_model_versions jsonb not null,
  created_at timestamptz not null default now()
);

comment on table public.intelligence_ensemble_versions is
  'One row per ensemble weight configuration — configured_baseline (a documented fixed experiment) or learned (fit only on a validation-period sample, never test data).';

alter table public.intelligence_ensemble_versions enable row level security;
