-- public.execution_requests (Section 07 §12/§15/§29 — Execution Request
-- Canonical Contract / Global Execution Gate / Execution Idempotency).
-- The persisted, auditable record of every attempted execution — both
-- the request payload (`ExecutionIntegrationRequest`) and the outcome of
-- the `GlobalExecutionGate.authorize()` call that gated it. `ticket_id`
-- is null for Aviator signal-based requests (`ticket_or_signal_id` then
-- names a signal, not a football ticket) — `ticket_or_signal_id` is
-- always populated either way, mirroring `ExecutionIntegrationRequest.
-- ticketOrSignalId` exactly.
--
-- "Execution idempotency (real DB enforcement, test against real
-- Postgres)" — `idempotency_key` carries a real UNIQUE constraint below;
-- a duplicate request for the same key is a database-level conflict, not
-- merely an application-level check.

create table public.execution_requests (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid null references public.tickets(id),
  ticket_or_signal_id text not null,
  requested_by uuid not null references public.users(id),
  execution_mode public.execution_mode not null,
  stake numeric not null check (stake > 0),
  market_type text null,
  selection text null,
  odds numeric null check (odds is null or odds > 1),
  idempotency_key text not null,
  user_confirmed boolean not null default false,
  gate_authorized boolean not null,
  gate_failed_check text null,
  gate_denial_code text null,
  gate_denial_reason text null,
  requested_at timestamptz not null default now()
);

comment on table public.execution_requests is
  'One row per attempted execution (Section 07), whatever the GlobalExecutionGate outcome — gate_authorized=false rows are the auditable record of a DENIED attempt, not deleted/hidden. idempotency_key is real-UNIQUE below: a retried request with the same key must fail the insert, never silently create a second attempt.';

create unique index execution_requests_idempotency_key_idx on public.execution_requests (idempotency_key);
create index execution_requests_ticket_id_idx on public.execution_requests (ticket_id);
create index execution_requests_requested_by_idx on public.execution_requests (requested_by);

alter table public.execution_requests enable row level security;
