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

-- One current result row per fixture. A provider correction UPDATEs
-- this row (bumping correction_count/corrected_at) rather than losing
-- the original — full historical versioning of corrections was judged
-- unnecessary complexity for this section; the audit_logs entry
-- recorded alongside every correction (see FOOTBALL_DATA_ARCHITECTURE.md)
-- is the provenance trail.
create table public.match_results (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.fixtures(id) on delete cascade unique,
  home_goals integer not null check (home_goals >= 0),
  away_goals integer not null check (away_goals >= 0),
  halftime_home_goals integer null check (halftime_home_goals is null or halftime_home_goals >= 0),
  halftime_away_goals integer null check (halftime_away_goals is null or halftime_away_goals >= 0),
  result_recorded_at timestamptz not null,
  source text not null,
  corrected_at timestamptz null,
  correction_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.match_results enable row level security;

create trigger set_match_results_updated_at
before update on public.match_results
for each row execute function public.set_updated_at();
