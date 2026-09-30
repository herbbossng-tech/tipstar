-- public.market_observations (Section 07 §5/§7/§11 — Market Engine
-- Integration / Odds Validity / Market Suspension). The persisted form of
-- @sport-os/market-engine's `MarketObservation` — the canonical, single
-- snapshot a Value Engine call reads via `ValueEngineDependencies.
-- getMarketObservation()`. Distinct from Section 04's `odds_observations`
-- (raw provider odds ingestion, no line/status/schema_version, feeds
-- features/backtesting) — this table is Section 07's own, validity-
-- checkable market state, never a duplicate of the ingestion pipeline.
--
-- Append-only: a new market observation is a NEW row, never an UPDATE of
-- an existing one — "historical odds records never overwritten" (§35/
-- Immutability). Staleness is measured by the application layer's
-- `checkOddsValidity()` (OddsValidityConfig.maxOddsAgeSeconds) comparing
-- `odds_timestamp` against the evaluation time; there is no DB-level
-- staleness enforcement here, matching how oddsValidity config is never
-- hardcoded (§Stale Odds Policy).

create table public.market_observations (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.fixtures(id) on delete cascade,
  market_type text not null,
  selection text not null,
  line numeric null,
  odds numeric null check (odds is null or odds > 1),
  odds_timestamp timestamptz not null,
  source text not null,
  source_observation_id text null,
  status public.market_status not null default 'open',
  schema_version integer not null default 1,
  created_at timestamptz not null default now()
);

comment on table public.market_observations is
  'Append-only canonical market snapshots (Section 07). The point-in-time-safe read for a given (fixture_id, market_type, selection, line) is "the row with the greatest odds_timestamp" — see ValueEngineDependencies.getMarketObservation(). Never UPDATEd.';

create index market_observations_lookup_idx on public.market_observations (fixture_id, market_type, selection, odds_timestamp);

alter table public.market_observations enable row level security;
