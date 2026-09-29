-- public.agent_invocations (Section 06 — Agent Framework). The durable
-- record of every agent invocation — see
-- packages/agent-core/src/invocation.ts's AgentInvocationRecord, whose
-- shape this mirrors exactly. Every agent-core InvocationsRepository
-- method (create/getById/getByIdempotencyKey/transitionTo/
-- listByCorrelationId) maps directly onto a query against this table —
-- see packages/agents/src/db/repositories.ts's SupabaseInvocationsRepository.

create table public.agent_invocations (
  id uuid primary key,
  agent_id text not null,
  agent_type public.agent_type not null,
  agent_version text not null,
  correlation_id uuid not null,
  requested_by uuid not null references public.users (id),
  side_effect_level public.agent_side_effect_level not null,
  status public.agent_invocation_status not null default 'idle',
  failure_disposition public.agent_failure_disposition null,
  failure_code public.agent_failure_code null,
  failure_message text null,
  failure_context jsonb null,
  -- An opaque reference (a message id, a storage key) — never the raw
  -- input/output payload. Keeps this table small and out of the
  -- business-data path, exactly like SupabaseAuditService keeps
  -- audit_logs.metadata redacted rather than storing raw payloads.
  input_reference text not null,
  output_reference text null,
  idempotency_key text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  -- A failure_disposition/failure_code must appear together with a
  -- FAILED status, never independently — mirrors
  -- InMemoryInvocationsRepository.transitionTo's own invariant at the
  -- database level.
  check ((status = 'failed') = (failure_code is not null)),
  check ((status = 'failed') = (failure_disposition is not null))
);

comment on table public.agent_invocations is
  'One row per agent invocation (Section 06). Status transitions are validated in application code (packages/agent-core/src/invocation.ts''s isValidInvocationTransition) before ever reaching this table — the CHECK constraints here are a defense-in-depth mirror, not the primary enforcement.';

-- Idempotency (Section 06 §20): a repeat idempotencyKey for the same
-- agent_type must resolve to the SAME invocation, never a new row — a
-- real, database-level guarantee, not merely an application-level check.
create unique index agent_invocations_agent_type_idempotency_key_idx
  on public.agent_invocations (agent_type, idempotency_key)
  where idempotency_key is not null;

create index agent_invocations_correlation_id_idx on public.agent_invocations (correlation_id);
create index agent_invocations_status_idx on public.agent_invocations (status);
create index agent_invocations_requested_by_idx on public.agent_invocations (requested_by);

alter table public.agent_invocations enable row level security;
