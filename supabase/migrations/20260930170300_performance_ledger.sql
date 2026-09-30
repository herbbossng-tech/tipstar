-- public.performance_ledger (Section 08 §23/§25/§29 — Performance
-- Ledger / Performance Metrics / Performance Breakdowns). One row per
-- `PerformanceLedgerEntry` (`@sport-os/settlement-engine/performance.ts`'s
-- `buildPerformanceLedgerEntry()` output) — a computed AGGREGATE over
-- already-settled records, never a duplicate store of the individual
-- settlements themselves (those live in `settlements`/`settlement_legs`;
-- this table is the cache/snapshot of a recomputable rollup).
--
-- `sport`/`league`/`market`/`model_version`/`decision_policy_version`/
-- `ticket_type` are the breakdown dimensions (§29) — each nullable,
-- meaning "not broken out by this axis for this row," never "unknown."

create table public.performance_ledger (
  id uuid primary key default gen_random_uuid(),
  period_start timestamptz not null,
  period_end timestamptz not null,
  ledger_mode public.ledger_mode not null,
  sport text not null,
  league text null,
  market text null,
  model_version text null,
  decision_policy_version text null,
  ticket_type text null,
  -- §24 — an accumulator is ONE ticket regardless of leg count.
  ticket_count integer not null check (ticket_count >= 0),
  leg_count integer not null check (leg_count >= 0),
  executed_ticket_count integer not null check (executed_ticket_count >= 0),
  settled_ticket_count integer not null check (settled_ticket_count >= 0),
  wins integer not null check (wins >= 0),
  losses integer not null check (losses >= 0),
  voids integer not null check (voids >= 0),
  pushes integer not null check (pushes >= 0),
  pending integer not null check (pending >= 0),
  actual_stake_amount numeric null,
  actual_stake_currency text null,
  actual_payout_amount numeric null,
  actual_payout_currency text null,
  actual_pnl_amount numeric null,
  actual_pnl_currency text null,
  roi numeric null,
  expected_ev numeric null,
  max_drawdown numeric null,
  longest_losing_streak integer null check (longest_losing_streak is null or longest_losing_streak >= 0),
  -- §37 — every performance aggregate exposes its own sample size.
  sample_size integer not null check (sample_size >= 0),
  computed_at timestamptz not null default now(),
  check ((actual_stake_amount is null) = (actual_stake_currency is null)),
  check ((actual_payout_amount is null) = (actual_payout_currency is null)),
  check ((actual_pnl_amount is null) = (actual_pnl_currency is null))
);

comment on table public.performance_ledger is
  'Recomputable performance aggregates (Section 08). The (period, ledger_mode, sport, league, market, model_version, decision_policy_version, ticket_type) UNIQUE constraint below is a defense-in-depth guard for the common case where every dimension is explicitly set — SQL treats each NULL as distinct, so it does not by itself prevent duplicate rows when optional dimensions are left null; recomputing and replacing a row for the same dimension tuple is an application-layer upsert responsibility.';

create unique index performance_ledger_dimensions_idx on public.performance_ledger (period_start, period_end, ledger_mode, sport, league, market, model_version, decision_policy_version, ticket_type);
create index performance_ledger_sport_idx on public.performance_ledger (sport);
create index performance_ledger_period_idx on public.performance_ledger (period_start, period_end);

alter table public.performance_ledger enable row level security;
