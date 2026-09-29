-- public.venues / public.teams (Section 04 — Canonical Football Data
-- Model). Provider mapping must not depend on team name alone — names
-- can change; provider_team_id is the real identity anchor.

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  provider text null,
  provider_venue_id text null,
  name text not null,
  city text null,
  country text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Partial unique: a venue may be created without provider identity
-- (e.g. manually referenced before a provider confirms it), but two
-- venues from the SAME provider must not collide.
create unique index venues_provider_unique_idx on public.venues (provider, provider_venue_id) where provider is not null and provider_venue_id is not null;

alter table public.venues enable row level security;

create trigger set_venues_updated_at
before update on public.venues
for each row execute function public.set_updated_at();

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_team_id text not null,
  name text not null,
  short_name text null,
  country text null,
  venue_id uuid null references public.venues(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_team_id)
);

comment on table public.teams is
  'Provider mapping is by provider_team_id, never by name alone (names change) — see docs/architecture/FOOTBALL_DATA_ARCHITECTURE.md''s "Entity matching".';

create index teams_venue_id_idx on public.teams (venue_id);

alter table public.teams enable row level security;

create trigger set_teams_updated_at
before update on public.teams
for each row execute function public.set_updated_at();
