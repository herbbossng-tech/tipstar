-- public.intelligence_dataset_versions (Section 05 — Training Dataset
-- Builder). One row per distinct dataset build — never the examples
-- themselves (see the module comment in
-- packages/football-engine/src/feature-store.ts on why bulk feature
-- matrices are not persisted). Reproducibility comes from this row's
-- parameters plus deterministic recomputation against Section 04's
-- stored data, not from storing the computed rows.

create table public.intelligence_dataset_versions (
  id uuid primary key default gen_random_uuid(),
  dataset_version text not null unique,
  snapshot_lead_time_minutes integer not null,
  competition_ids uuid[] null,
  sample_count integer not null,
  excluded_count integer not null,
  built_at timestamptz not null,
  created_at timestamptz not null default now()
);

comment on table public.intelligence_dataset_versions is
  'One row per training-dataset build (parameters + summary counts only, never the examples themselves — recompute deterministically from Section 04 data instead).';
comment on column public.intelligence_dataset_versions.competition_ids is
  'null means "every competition" — not an empty-array sentinel.';

create index intelligence_dataset_versions_built_at_idx on public.intelligence_dataset_versions (built_at);

alter table public.intelligence_dataset_versions enable row level security;
