-- public.audit_logs — Section 03 Audit Persistence.
--
-- Append-only by convention: no UPDATE/DELETE policy exists for any
-- client role (see the RLS policies migration), and application code
-- (SupabaseAuditService in @sport-os/platform) never issues an
-- UPDATE/DELETE against this table either. outcome mirrors Section 01's
-- @sport-os/platform AuditOutcome const exactly (success/failure/denied).

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid null references public.users(id),
  action text not null,
  resource_type text not null,
  resource_id uuid null,
  outcome text not null check (outcome in ('success', 'failure', 'denied')),
  request_id text null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

comment on table public.audit_logs is
  'Append-only. metadata must never contain bot tokens, session signing secrets, raw initData, passwords, private keys, or full license keys — see docs/architecture/DATABASE_AND_RLS.md.';

create index audit_logs_actor_user_id_idx on public.audit_logs (actor_user_id);
create index audit_logs_resource_id_idx on public.audit_logs (resource_id);
create index audit_logs_created_at_idx on public.audit_logs (created_at);

alter table public.audit_logs enable row level security;
