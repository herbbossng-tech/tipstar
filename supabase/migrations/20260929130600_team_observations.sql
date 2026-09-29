-- public.team_observations (Section 04 — Team Performance Snapshots /
-- Data Observation Time).
--
-- Deliberately NOT a fixed-column "team stats" table: the spec lists
-- form/goals/xG/shots/possession/corners/cards as EXAMPLE concepts, not
-- a locked schema, and explicitly reserves rolling/derived feature
-- computation for Section 05 ("Section 04 should preserve trustworthy
-- raw/normalized observations"). `metrics` is a flexible JSONB bag of
-- whatever a provider actually supplied for this observation — nothing
-- is fabricated to fill a fixed column a provider doesn't support.
--
-- Append-only, like match_events: a correction is a NEW observation
-- with a later observed_at, never an UPDATE to an existing one — this
-- is what "preserve provenance and correction semantics" means here.

create table public.team_observations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id),
  fixture_id uuid null references public.fixtures(id),
  competition_id uuid null references public.competitions(id),
  observation_type text not null,
  metrics jsonb not null default '{}',
  -- Mandatory: when THIS SYSTEM observed/ingested the data.
  observed_at timestamptz not null,
  -- When the provider says the underlying fact became true/known, if
  -- they report it — may differ from observed_at (our ingestion lag).
  provider_published_at timestamptz null,
  source_updated_at timestamptz null,
  provider text not null,
  provider_observation_id text null,
  ingestion_run_id uuid null references public.ingestion_runs(id),
  created_at timestamptz not null default now()
);

create index team_observations_team_id_idx on public.team_observations (team_id);
create index team_observations_fixture_id_idx on public.team_observations (fixture_id);
create index team_observations_observed_at_idx on public.team_observations (observed_at);
create index team_observations_observation_type_idx on public.team_observations (observation_type);

alter table public.team_observations enable row level security;
