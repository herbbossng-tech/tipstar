-- public.ingestion_runs (Section 04 — Ingestion Run / Observability).
-- Every ingestion job produces exactly one of these. Created early in
-- migration order since team_observations/odds_observations reference
-- it by ingestion_run_id.

create table public.ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  mode public.ingestion_mode not null,
  status public.ingestion_status not null default 'running',
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  records_received integer not null default 0,
  records_inserted integer not null default 0,
  records_updated integer not null default 0,
  records_rejected integer not null default 0,
  error_count integer not null default 0,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

comment on table public.ingestion_runs is
  'One row per ingestion job. metadata must stay small — never a dumping ground for raw provider payloads (see data_quarantine for that).';

create index ingestion_runs_provider_idx on public.ingestion_runs (provider);
create index ingestion_runs_started_at_idx on public.ingestion_runs (started_at);
create index ingestion_runs_status_idx on public.ingestion_runs (status);

alter table public.ingestion_runs enable row level security;
