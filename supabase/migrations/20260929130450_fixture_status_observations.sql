-- public.fixture_status_observations (Section 04 fix — Mutable Fixture
-- Status Leakage). `fixtures.status`/`provider_status_raw`/
-- `actual_kickoff_at` are mutable "current state" columns, upserted in
-- place on every re-sighting of a fixture — correct for "what's
-- happening now" reads, but wrong for a point-in-time query: a
-- historical snapshot taken before kickoff must see the status as it
-- was known THEN (e.g. 'scheduled'), never a status the fixture only
-- reached later (e.g. 'finished').
--
-- This table is the append-only history that makes fixture status
-- point-in-time reconstructable, mirroring the established
-- team_observations/odds_observations pattern: one immutable row per
-- observed transition, filtered by `observed_at <= asOf`
-- (FixturesRepository.getByIdAsOf). It does not replace the mutable
-- columns on `fixtures` (still the fast "current state" read — see
-- FixturesRepository.getById) — it exists alongside them so the
-- contract (`Fixture.status` etc.) never has to be removed, only made
-- safely reconstructable as of any past moment.
--
-- FixturesRepository.upsert() appends a row here only when
-- status/provider_status_raw/actual_kickoff_at actually changed (or on
-- a fixture's first sighting) — not on every re-poll of an unchanged
-- status, to avoid unbounded growth from routine ingestion polling.

create table public.fixture_status_observations (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.fixtures(id) on delete cascade,
  status public.match_status not null,
  provider_status_raw text null,
  actual_kickoff_at timestamptz null,
  observed_at timestamptz not null,
  provider text not null,
  created_at timestamptz not null default now()
);

comment on table public.fixture_status_observations is
  'Append-only fixture status history — never UPDATEd. The point-in-time-safe read is "the row with the greatest observed_at <= asOf" (see SupabaseFixturesRepository.getByIdAsOf); undefined/no row means the fixture''s status was not yet knowable as of that time.';

create index fixture_status_observations_fixture_id_observed_at_idx on public.fixture_status_observations (fixture_id, observed_at);

alter table public.fixture_status_observations enable row level security;
