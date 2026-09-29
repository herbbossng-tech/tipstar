-- public.intelligence_model_versions (Section 05 — Model Training
-- Safety: "Never overwrite a model version silently... Model artifacts
-- must be reproducible... Do not allow production inference to
-- unknowingly use an unversioned model."

create table public.intelligence_model_versions (
  id uuid primary key default gen_random_uuid(),
  model_family public.model_family not null,
  model_version text not null,
  training_dataset_version text not null references public.intelligence_dataset_versions (dataset_version),
  feature_schema jsonb not null,
  hyperparameters jsonb not null default '{}',
  random_seed integer not null,
  training_timestamp timestamptz not null,
  -- The model's fitted, serializable state (tree structures, network
  -- weights, or a baseline's own small parameter set) — small enough at
  -- this section's data scale to store as JSONB directly. A
  -- production-scale retrain producing much larger artifacts (many deep
  -- trees, a large network) would need blob/file storage instead of
  -- this column — see docs/architecture/OPEN_QUESTIONS.md's "production
  -- model artifact storage strategy".
  state jsonb not null,
  evaluation_run_id uuid null,
  created_at timestamptz not null default now(),
  unique (model_family, model_version)
);

comment on table public.intelligence_model_versions is
  'One row per trained model artifact. Never updated in place — a retrain is always a new row with a new model_version, per "never overwrite a model version silently".';
comment on column public.intelligence_model_versions.evaluation_run_id is
  'Set once a real EvaluationRun exists for this model — null for a freshly trained, not-yet-evaluated model. The FK to intelligence_evaluation_runs is added in a later migration once that table exists (avoids a forward reference).';

create index intelligence_model_versions_family_idx on public.intelligence_model_versions (model_family);
create index intelligence_model_versions_training_timestamp_idx on public.intelligence_model_versions (training_timestamp);

alter table public.intelligence_model_versions enable row level security;
