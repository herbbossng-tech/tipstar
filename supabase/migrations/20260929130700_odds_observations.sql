-- public.odds_observations (Section 04 — Odds Data / Market
-- Normalization / Odds Timestamp Rule).
--
-- "Odds are data, not predictions." Multiple observations per
-- fixture/market/selection are preserved — this table is never
-- upserted-over, only appended to, so closing-line comparison and
-- backtesting remain possible. market_type reuses (and Section 04
-- additively extends) @sport-os/market-engine's MarketType enum values
-- as plain text here — no FK to a markets table; the canonical list is
-- the TypeScript enum, validated at the application layer before
-- insert, matching how `provider` is handled throughout this schema.

create table public.odds_observations (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.fixtures(id) on delete cascade,
  market_type text not null,
  selection text not null,
  odds numeric not null check (odds > 0),
  bookmaker_source text not null,
  observed_at timestamptz not null,
  provider_published_at timestamptz null,
  -- "If provider timestamp is unavailable, mark the observation's
  -- temporal reliability as limited. Do not silently claim point-in-time
  -- accuracy." — 'confirmed' when provider_published_at is present,
  -- 'estimated' (our own ingestion time only) otherwise. Enforced by the
  -- application layer at insert, not a DB CHECK (deriving it from
  -- nullability alone would silently misclassify a provider that reports
  -- published_at equal to observed_at on purpose).
  temporal_reliability public.temporal_reliability not null,
  provider text not null,
  provider_observation_id text null,
  ingestion_run_id uuid null references public.ingestion_runs(id),
  created_at timestamptz not null default now()
);

create index odds_observations_fixture_id_idx on public.odds_observations (fixture_id);
create index odds_observations_observed_at_idx on public.odds_observations (observed_at);
create index odds_observations_market_type_idx on public.odds_observations (market_type);

alter table public.odds_observations enable row level security;
