-- public.tickets / public.ticket_status_history (Section 07 §12/§13/§14
-- — Ticket Engine / SINGLE vs ACCUMULATOR / Ticket Validation).
--
-- Mirrors the fixtures/fixture_status_observations split exactly (same
-- precedent, same reasoning): `tickets` is the mutable "current state"
-- row (id is the STABLE ticket_id from TicketRecord — one row per
-- ticket, upserted in place as it moves through its status machine),
-- while `ticket_status_history` is the append-only, NEVER-UPDATEd
-- history of every transition — "historical decision/ticket/odds
-- records never overwritten — new versions/observations instead" (§35).
-- SupabaseTicketsRepository.transitionStatus() (a later implementation
-- task) is expected to UPDATE `tickets` and INSERT into
-- `ticket_status_history` in the same transaction, exactly like
-- SupabaseFixturesRepository.upsert() does for fixtures/
-- fixture_status_observations today.
--
-- A 5-leg accumulator is ONE ticket with FIVE `ticket_legs` rows (§13) —
-- never five separate ticket rows.

create table public.tickets (
  id uuid primary key,
  ticket_type public.ticket_type not null,
  combined_odds numeric null check (combined_odds is null or combined_odds > 1),
  combined_probability numeric null check (combined_probability is null or (combined_probability > 0 and combined_probability <= 1)),
  combined_probability_method text null,
  combined_probability_calculation_version text null,
  version integer not null default 1 check (version >= 1),
  status public.ticket_status not null default 'DRAFT',
  stake numeric null check (stake is null or stake > 0),
  potential_return numeric null check (potential_return is null or potential_return >= 0),
  created_by uuid not null references public.users(id),
  idempotency_key text null,
  rejection_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.tickets is
  'Mutable "current state" ticket row (Section 07) — one row per ticket_id, updated in place on each status transition. See ticket_status_history for the append-only, never-UPDATEd audit trail of every version this ticket has passed through.';

-- Ticket-creation idempotency (§16/§43): a repeat idempotencyKey must
-- resolve to the SAME ticket, never a new row — a real, DB-level
-- guarantee mirroring agent_invocations' own idempotency index.
create unique index tickets_idempotency_key_idx on public.tickets (idempotency_key) where idempotency_key is not null;

create index tickets_created_by_idx on public.tickets (created_by);
create index tickets_status_idx on public.tickets (status);

alter table public.tickets enable row level security;

create table public.ticket_status_history (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  version integer not null check (version >= 1),
  status public.ticket_status not null,
  stake numeric null check (stake is null or stake > 0),
  potential_return numeric null check (potential_return is null or potential_return >= 0),
  rejection_reason text null,
  transitioned_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (ticket_id, version)
);

comment on table public.ticket_status_history is
  'Append-only ticket transition history (Section 07) — one row per version this ticket has held, mirroring TicketRecord''s immutable version-incrementing transitionTicketStatus(). Never UPDATEd.';

create index ticket_status_history_ticket_id_idx on public.ticket_status_history (ticket_id, version);

alter table public.ticket_status_history enable row level security;
