-- public.agent_idempotency_claims (Section 06 — Agent Framework §20).
-- The real, database-level enforcement behind
-- packages/agent-core/src/idempotency.ts's IdempotencyStore contract —
-- "Use unique constraints or equivalent backend enforcement... do not
-- rely solely on frontend checks." A (agent_type, idempotency_key) pair
-- can be claimed exactly once; SupabaseIdempotencyStore.claim()
-- (packages/agents/src/db/repositories.ts) always re-selects after its
-- upsert attempt, so under real concurrent requests racing the same key,
-- whichever one the database actually committed first is the one every
-- caller observes — never two independent "winners."
--
-- Deliberately a separate, minimal table rather than overloading
-- agent_invocations' own (agent_type, idempotency_key) unique index: the
-- orchestrator's dispatch flow claims an idempotency key BEFORE it has
-- enough information to create the full invocation row (see
-- AgentOrchestrator.dispatch in packages/agent-core/src/orchestrator.ts),
-- so the claim must be representable independently of whether an
-- invocation row ever ends up existing for it (e.g. a claim made by a
-- request that then failed side-effect-level validation before
-- `invocations.create()` was even called).

create table public.agent_idempotency_claims (
  agent_type public.agent_type not null,
  idempotency_key text not null,
  invocation_id uuid not null,
  recorded_at timestamptz not null default now(),
  primary key (agent_type, idempotency_key)
);

comment on table public.agent_idempotency_claims is
  'One row per (agent_type, idempotency_key) ever claimed — the primary key IS the exactly-once guarantee. Never deleted; a reused idempotency key must always resolve to its original claim, for the lifetime of that key.';

alter table public.agent_idempotency_claims enable row level security;
