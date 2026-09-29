-- Section 05 — Football Intelligence, Feature Store, Models &
-- Statistical Engine. Enum types for versioned intelligence metadata
-- (dataset/model/calibration/ensemble/training-run/evaluation-run
-- persistence — see docs/architecture/MODEL_VALIDATION.md's "Database
-- / Persistence"). Only what §21 actually asks to be persisted gets a
-- table; feature DEFINITIONS deliberately do not (they are
-- code-versioned — see packages/football-engine/src/feature-store.ts's
-- module comment).

create type public.model_family as enum (
  'naive_baseline', 'historical_frequency_baseline', 'elo_baseline', 'poisson_baseline', 'market_implied_baseline',
  'poisson', 'dixon_coles', 'monte_carlo',
  'random_forest', 'gradient_boosted_trees', 'neural_network'
);

create type public.calibrator_type as enum ('platt', 'isotonic');

create type public.ensemble_weight_source as enum ('configured_baseline', 'learned');

create type public.training_run_status as enum ('running', 'completed', 'failed');
