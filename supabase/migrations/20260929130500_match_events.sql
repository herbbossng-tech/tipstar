-- public.match_events (Section 04 — Match Events). Append-only: a
-- provider event is a point-in-time fact, never mutated once observed.
-- No updated_at/trigger — matches the append-only convention already
-- established for Section 03's auth_sessions/audit_logs.

create table public.match_events (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.fixtures(id) on delete cascade,
  event_type public.match_event_type not null,
  provider_event_type text null,
  team_id uuid null references public.teams(id),
  minute integer null check (minute is null or minute >= 0),
  -- The moment this event actually happened/was observed — the field
  -- LeakageGuard's point-in-time query filters on.
  observed_at timestamptz not null,
  provider text not null,
  provider_event_id text null,
  created_at timestamptz not null default now()
);

comment on table public.match_events is
  'Append-only observations. provider_event_type preserves the source value for provenance alongside the normalized event_type.';

create index match_events_fixture_id_idx on public.match_events (fixture_id);
create index match_events_observed_at_idx on public.match_events (observed_at);

-- Only enforced when the provider actually supplies a stable event id —
-- many providers don't, so this can't be a blanket NOT NULL unique.
create unique index match_events_provider_unique_idx on public.match_events (provider, provider_event_id) where provider_event_id is not null;

alter table public.match_events enable row level security;
