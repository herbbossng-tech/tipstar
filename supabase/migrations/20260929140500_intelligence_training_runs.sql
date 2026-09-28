-- public.intelligence_training_runs (Section 05 — Model Training
-- Safety + Walk-Forward Validation). "Every model training run must
-- record: ... training window, validation window, test window,
-- random seed, hyperparameters..." — the walk-forward window
-- boundaries a given model_version was actually trained/validated/
-- tested against (see packages/football-engine/src/validation/
-- walk-forward.ts's WalkForwardWindow, whose shape this mirrors).

create table public.intelligence_training_runs (
  id uuid primary key default gen_random_uuid(),
  model_version_id uuid not null references public.intelligence_model_versions (id),
  status public.training_run_status not null default 'running',
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  train_start timestamptz not null,
  train_end timestamptz not null,
  validation_start timestamptz not null,
  validation_end timestamptz not null,
  test_start timestamptz not null,
  test_end timestamptz not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  check (validation_start >= train_end),
  check (test_start >= validation_end)
);

comment on table public.intelligence_training_runs is
  'One row per walk-forward training run. The two CHECK constraints are a database-level, defense-in-depth mirror of walk-forward.ts''s own chronology invariant — validation never starts before training ends, test never starts before validation ends.';

create index intelligence_training_runs_model_version_idx on public.intelligence_training_runs (model_version_id);
create index intelligence_training_runs_status_idx on public.intelligence_training_runs (status);

alter table public.intelligence_training_runs enable row level security;
