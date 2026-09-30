-- public.backtest_runs / public.backtest_results (Section 08 §31/§34 —
-- Backtesting / Backtest Metrics). Reuses Section 05's real walk-forward/
-- evaluation infrastructure directly — `training_run_id`/
-- `evaluation_run_id` reference `intelligence_training_runs`/
-- `intelligence_evaluation_runs` (window boundaries, model/dataset/
-- calibration lineage, predictive-quality metrics) rather than
-- duplicating any of those columns here. `status` reuses the existing
-- `public.training_run_status` enum ('running'/'completed'/'failed') —
-- never a second, near-identical enum.
--
-- This table exists purely to add the layer Section 05 explicitly
-- excluded: "Do not use ROI or realized betting profit as the primary
-- intelligence metric... belongs to the later performance/backtesting
-- layer." Every backtest is unconditionally simulated — `settlements`
-- rows produced by a backtest always carry `ledger_mode = 'PAPER'`
-- (§33), so a backtest can never contaminate a LIVE performance ledger
-- entry by construction (the two are always filtered apart by
-- `ledger_mode`, never by which table they happen to live in).

create table public.backtest_runs (
  id uuid primary key default gen_random_uuid(),
  training_run_id uuid null references public.intelligence_training_runs(id),
  evaluation_run_id uuid null references public.intelligence_evaluation_runs(id),
  decision_policy_version text not null,
  settlement_policy_version text not null,
  stake_per_ticket numeric not null check (stake_per_ticket > 0),
  currency text not null,
  status public.training_run_status not null default 'running',
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  created_at timestamptz not null default now()
);

comment on table public.backtest_runs is
  'One row per backtest execution (Section 08). Links to the real Section 05 training/evaluation run it replays against — never duplicates window/model/dataset lineage columns.';

create index backtest_runs_training_run_id_idx on public.backtest_runs (training_run_id);
create index backtest_runs_status_idx on public.backtest_runs (status);

alter table public.backtest_runs enable row level security;

create table public.backtest_results (
  id uuid primary key default gen_random_uuid(),
  backtest_run_id uuid not null references public.backtest_runs(id) on delete cascade,
  -- The financial-performance rollup for this backtest (built via the SAME
  -- buildPerformanceLedgerEntry() every live/paper ledger entry uses —
  -- see performance_ledger.sql's own comment).
  performance_ledger_id uuid null references public.performance_ledger(id),
  sample_count integer not null check (sample_count >= 0),
  -- Predictive-quality metrics (§34), reused from Section 05's real
  -- evaluation/metrics.ts — never a second implementation. Null (never a
  -- forced 0) when the backtest had zero 1X2 decision points to compute
  -- them from.
  accuracy double precision null,
  log_loss double precision null,
  brier_score double precision null,
  -- Closing-Line Value (§28), averaged only over decision points where a
  -- real closing price was resolved — clv_sample_count is always the
  -- true denominator, never assumed equal to sample_count.
  clv_average double precision null,
  clv_sample_count integer not null default 0 check (clv_sample_count >= 0),
  by_market jsonb not null default '{}',
  by_league jsonb not null default '{}',
  computed_at timestamptz not null default now()
);

comment on table public.backtest_results is
  'One row per backtest run''s computed metrics (Section 08). by_market/by_league are structured breakdown extension points (§29) — populated by the application layer, never invented here.';

create index backtest_results_backtest_run_id_idx on public.backtest_results (backtest_run_id);

alter table public.backtest_results enable row level security;
