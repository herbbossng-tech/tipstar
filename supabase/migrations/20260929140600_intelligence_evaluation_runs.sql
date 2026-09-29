-- public.intelligence_evaluation_runs (Section 05 — Evaluation
-- Framework). "Do NOT use ROI or realized betting profit as the
-- primary intelligence metric in this section" — every metric column
-- here is a predictive-quality metric, never a profit/loss figure.
-- Exactly one of model_version_id / ensemble_version should be set
-- (evaluating a single model vs. an ensembled combination) — enforced
-- at the application layer (packages/football-engine/src/evaluation/),
-- not a SQL constraint, since "exactly one of two nullable columns" is
-- awkward to express robustly across this repo's local RLS test
-- harness.

create table public.intelligence_evaluation_runs (
  id uuid primary key default gen_random_uuid(),
  model_version_id uuid null references public.intelligence_model_versions (id),
  ensemble_version text null references public.intelligence_ensemble_versions (ensemble_version),
  calibration_version_id uuid null references public.intelligence_calibration_versions (id),
  dataset_version text not null references public.intelligence_dataset_versions (dataset_version),
  sample_count integer not null,
  accuracy double precision not null,
  log_loss double precision not null,
  brier_score double precision not null,
  expected_calibration_error double precision not null,
  missing_feature_rate double precision not null,
  data_quality_distribution jsonb not null,
  calibration_buckets jsonb not null,
  by_competition jsonb not null,
  by_season jsonb not null,
  evaluated_at timestamptz not null,
  created_at timestamptz not null default now()
);

comment on table public.intelligence_evaluation_runs is
  'One row per evaluation — a structured summary (packages/football-engine/src/evaluation/summary.ts''s EvaluationSummary), never a bare accuracy number and never a profit/ROI figure.';

create index intelligence_evaluation_runs_model_version_idx on public.intelligence_evaluation_runs (model_version_id);
create index intelligence_evaluation_runs_evaluated_at_idx on public.intelligence_evaluation_runs (evaluated_at);

alter table public.intelligence_evaluation_runs enable row level security;

-- Deferred FK from intelligence_model_versions.evaluation_run_id, now
-- that this table exists (avoids a forward reference in that earlier
-- migration).
alter table public.intelligence_model_versions
  add constraint intelligence_model_versions_evaluation_run_id_fkey
  foreign key (evaluation_run_id) references public.intelligence_evaluation_runs (id);
