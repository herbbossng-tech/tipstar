-- public.competitions / public.seasons (Section 04 — Canonical Football
-- Data Model). Provider identifiers are namespaced by provider — never
-- assumed globally unique (a competition's provider_competition_id from
-- provider A means nothing to provider B).

create table public.competitions (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_competition_id text not null,
  name text not null,
  country text null,
  competition_type text null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_competition_id)
);

alter table public.competitions enable row level security;

create trigger set_competitions_updated_at
before update on public.competitions
for each row execute function public.set_updated_at();

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  provider text not null,
  provider_season_id text not null,
  name text not null,
  start_date date null,
  end_date date null,
  status text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_season_id)
);

create index seasons_competition_id_idx on public.seasons (competition_id);

alter table public.seasons enable row level security;

create trigger set_seasons_updated_at
before update on public.seasons
for each row execute function public.set_updated_at();
