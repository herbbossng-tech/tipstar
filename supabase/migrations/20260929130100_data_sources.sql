-- public.data_sources — registry of known football/odds providers
-- (Section 04 — Data Provenance / Provider Configuration).
--
-- Deliberately NOT foreign-keyed to from every other table's `provider`
-- column: `provider` is a plain, namespaced text identifier throughout
-- this schema (matching the spec's own example, `provider = "provider_a"`),
-- so ingestion never blocks on a provider being pre-registered here.
-- This table is instead an operational registry — enable/disable a
-- provider, see when it was last configured — kept in sync by the
-- ingestion layer (`registerDataSource()`), not a hard dependency of
-- every ingested row.

create table public.data_sources (
  id uuid primary key default gen_random_uuid(),
  provider text not null unique,
  display_name text not null,
  kind text not null check (kind in ('football_data', 'odds')),
  enabled boolean not null default true,
  base_url text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.data_sources is
  'Operational registry of football/odds providers. Not a hard FK dependency for other tables — provider is a plain namespaced text identifier throughout this schema.';

alter table public.data_sources enable row level security;

create trigger set_data_sources_updated_at
before update on public.data_sources
for each row execute function public.set_updated_at();
