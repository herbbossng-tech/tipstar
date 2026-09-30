-- public.ticket_legs (Section 07 §12/§13 — Ticket Engine / SINGLE vs
-- ACCUMULATOR). One row per `TicketLeg` (ticket-engine.ts) — a 5-leg
-- accumulator is FIVE rows sharing one `ticket_id`, never five separate
-- tickets (§13). Legs are fixed for the lifetime of a ticket (set once
-- when the DRAFT is created by `createTicketDraft()`; nothing in
-- `ticket-engine.ts` ever mutates a ticket's legs across a status
-- transition) — so, unlike `ticket_status_history`, this table has no
-- per-version rows: it references `ticket_id` alone and is itself
-- immutable once written (INSERT-only, never UPDATEd/DELETEd except by
-- the ticket's own cascade).

create table public.ticket_legs (
  id uuid primary key,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  fixture_id uuid not null references public.fixtures(id),
  market_type text not null,
  selection text not null,
  line numeric null,
  probability numeric not null check (probability > 0 and probability <= 1),
  odds numeric not null check (odds > 1),
  fair_odds numeric null check (fair_odds is null or fair_odds > 1),
  expected_value numeric null,
  edge numeric null,
  model_version text null,
  calculation_version text not null,
  value_evaluated_at timestamptz not null,
  leakage_flag boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.ticket_legs is
  'Immutable, insert-only legs of a ticket (Section 07) — the set of legs never changes across a ticket''s status transitions. A ticket with N rows here is a single N-leg accumulator (N>1) or single bet (N=1) — see deriveTicketType().';

create index ticket_legs_ticket_id_idx on public.ticket_legs (ticket_id);
create index ticket_legs_fixture_id_idx on public.ticket_legs (fixture_id);

alter table public.ticket_legs enable row level security;
