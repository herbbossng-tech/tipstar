-- public.data_quarantine / public.data_conflicts (Section 04 —
-- Quarantine / Data Conflicts). Problematic provider data is never
-- silently discarded (quarantine) and disagreements between providers
-- are never silently resolved by picking one (conflicts).

create table public.data_quarantine (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_record_id text null,
  entity_type text not null,
  reason text not null,
  -- Small, bounded reference only — never an unbounded raw payload dump.
  -- See FOOTBALL_DATA_ARCHITECTURE.md's "Raw ingestion" for the size
  -- policy this is expected to respect.
  raw_payload jsonb null,
  detected_at timestamptz not null default now(),
  ingestion_run_id uuid null references public.ingestion_runs(id),
  resolved_at timestamptz null,
  created_at timestamptz not null default now()
);

create index data_quarantine_provider_idx on public.data_quarantine (provider);
create index data_quarantine_ingestion_run_id_idx on public.data_quarantine (ingestion_run_id);
create index data_quarantine_detected_at_idx on public.data_quarantine (detected_at);

alter table public.data_quarantine enable row level security;

create table public.data_conflicts (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_ref text not null,
  field text not null,
  source_a text not null,
  value_a text null,
  source_b text not null,
  value_b text null,
  detected_at timestamptz not null default now(),
  resolution_status public.data_conflict_status not null default 'unresolved',
  resolved_value text null,
  resolved_at timestamptz null,
  created_at timestamptz not null default now()
);

comment on table public.data_conflicts is
  'No source-priority policy is encoded here — resolution_status stays unresolved until a human or a documented, evidence-based policy resolves it. See docs/architecture/OPEN_QUESTIONS.md.';

create index data_conflicts_entity_ref_idx on public.data_conflicts (entity_ref);
create index data_conflicts_resolution_status_idx on public.data_conflicts (resolution_status);

alter table public.data_conflicts enable row level security;
