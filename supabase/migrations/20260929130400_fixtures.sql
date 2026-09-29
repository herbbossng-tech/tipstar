-- public.fixtures / public.match_results (Section 04 — Canonical
-- Football Data Model / Match Status / Match Result).
--
-- scheduled_kickoff_at and actual_kickoff_at are deliberately separate
-- columns: a delayed match's original scheduled time must never be
-- overwritten (see "Fixture" in the section spec — this is the field
-- every point-in-time snapshot anchors against).

create table public.fixtures (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id),
  season_id uuid null references public.seasons(id),
  home_team_id uuid not null references public.teams(id),
  away_team_id uuid not null references public.teams(id),
  scheduled_kickoff_at timestamptz not null,
  actual_kickoff_at timestamptz null,
  status public.match_status not null default 'scheduled',
  -- Original provider status string, preserved for provenance — see
  -- "DATA NORMALIZATION": normalizing "FT" -> FINISHED must never
  -- destroy the source value.
  provider_status_raw text null,
  venue_id uuid null references public.venues(id),
  provider text not null,
  provider_fixture_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_fixture_id),
  check (home_team_id <> away_team_id)
);

comment on table public.fixtures is
  'The central football entity. scheduled_kickoff_at is set once at creation and never overwritten by a delay/reschedule — see actual_kickoff_at instead.';

create index fixtures_competition_id_idx on public.fixtures (competition_id);
create index fixtures_season_id_idx on public.fixtures (season_id);
create index fixtures_scheduled_kickoff_at_idx on public.fixtures (scheduled_kickoff_at);
create index fixtures_status_idx on public.fixtures (status);
create index fixtures_home_team_id_idx on public.fixtures (home_team_id);
create index fixtures_away_team_id_idx on public.fixtures (away_team_id);

alter table public.fixtures enable row level security;

create trigger set_fixtures_updated_at
before update on public.fixtures
for each row execute function public.set_updated_at();

-- Append-only result VERSIONS, one row per version, never mutated once
-- written (no `unique(fixture_id)` — deliberately allows many rows per
-- fixture). A provider correction INSERTs a new row rather than
-- UPDATEing the prior one: `result_recorded_at` is that row's own,
-- immutable "when did we learn this" timestamp, never overwritten or
-- inherited from an earlier version, which is exactly what makes it
-- safe to filter on for point-in-time queries (`result_recorded_at <=
-- asOf`). `corrected_at`/`correction_count` are per-version provenance
-- (null/0 for the original version; set/incrementing for each
-- correction after it). This replaces an earlier design that UPDATEd a
-- single row per fixture while preserving only the original
-- `result_recorded_at` — that let a correction's new score leak through
-- the original (pre-correction) timestamp on any historical, point-in-
-- time query. See LEAKAGE_PROTECTION.md and OPEN_QUESTIONS.md #13
-- (resolved).
create table public.match_results (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.fixtures(id) on delete cascade,
  home_goals integer not null check (home_goals >= 0),
  away_goals integer not null check (away_goals >= 0),
  halftime_home_goals integer null check (halftime_home_goals is null or halftime_home_goals >= 0),
  halftime_away_goals integer null check (halftime_away_goals is null or halftime_away_goals >= 0),
  result_recorded_at timestamptz not null,
  source text not null,
  corrected_at timestamptz null,
  correction_count integer not null default 0,
  -- Deterministic tiebreaker (PR review fix — Deterministic Match-Result
  -- Version Ordering). result_recorded_at is the temporal "known-at"
  -- field a point-in-time query filters on, but two versions CAN share
  -- the exact same result_recorded_at (e.g. a provider re-reports at the
  -- same nominal timestamp) — without a secondary sort key, `ORDER BY
  -- result_recorded_at DESC LIMIT 1` has no guaranteed winner among
  -- ties, so which row getAsOf()/getLatest() return would be
  -- unspecified. version_seq is a plain auto-incrementing identity
  -- column with no temporal meaning of its own — it exists purely to
  -- make "the most recently inserted of the tied versions wins"
  -- deterministic, mirroring the in-memory repository's already-
  -- deterministic array-insertion-order behavior. Never conflate this
  -- with created_at (a plain timestamp column is not itself a reliable
  -- total order — clock resolution/skew can produce ties too) or with
  -- result_recorded_at (the temporal field, which this does not
  -- replace).
  version_seq integer generated always as identity,
  created_at timestamptz not null default now()
);

comment on table public.match_results is
  'Append-only result versions — many rows per fixture_id are expected (the original plus one per correction). Never UPDATEd after insert. The point-in-time-safe read orders by result_recorded_at DESC, version_seq DESC and takes the first row (see SupabaseMatchResultsRepository.getAsOf); "current" reads (getLatest) use the same ordering with no asOf filter.';

create index match_results_fixture_id_recorded_at_idx on public.match_results (fixture_id, result_recorded_at, version_seq);

alter table public.match_results enable row level security;
