-- public.agent_messages (Section 06 — Agent Framework §18/28). The
-- append-only persisted log of every dispatched AgentMessage — see
-- packages/agent-core/src/messages.ts's AgentMessage, whose shape this
-- mirrors. Distinct from agent_invocations: a message that fails schema
-- validation or targets an unrecognized agent is still worth a durable
-- record for observability (§27), even though it never produces an
-- invocation.

create table public.agent_messages (
  id uuid primary key,
  correlation_id uuid not null,
  kind public.agent_message_kind not null,
  -- CommandType/EventType are an open, code-versioned set in TypeScript
  -- (packages/agent-core/src/messages.ts) — stored as text here rather
  -- than a Postgres enum so adding a new command/event never needs a
  -- migration, mirroring how Section 05 keeps feature DEFINITIONS
  -- code-versioned rather than a database enum.
  message_type text not null,
  schema_version int not null,
  source_agent text not null,
  target_agent public.agent_type not null,
  payload jsonb not null,
  idempotency_key text null,
  created_at timestamptz not null default now()
);

comment on table public.agent_messages is
  'Append-only log of every dispatched agent message (Section 06). Never updated or deleted after insert.';

create index agent_messages_correlation_id_idx on public.agent_messages (correlation_id);
create index agent_messages_target_agent_idx on public.agent_messages (target_agent);

alter table public.agent_messages enable row level security;
