-- RLS policies and grants for the Section 06 agent-operational schema.
-- Same shape as Section 04/05's operational tables (data_sources/
-- ingestion_runs/intelligence_*): these are internal orchestration
-- records, not user-facing content, so every table here is admin-only
-- SELECT, never broad `authenticated` write access. "Authenticated
-- users must not gain arbitrary write access to operational agent
-- state. Service-role/backend writes only where appropriate." — no
-- INSERT/UPDATE/DELETE policy exists anywhere in this file for
-- anon/authenticated on any table; every write happens through the
-- service-role-backed SupabaseInvocationsRepository/
-- SupabaseIdempotencyStore/SupabaseAgentMessagesRepository
-- (packages/agents/src/db/repositories.ts), never a direct client write.

revoke all on
  public.agent_invocations, public.agent_idempotency_claims, public.agent_messages
  from anon, authenticated;

grant select on
  public.agent_invocations, public.agent_messages
  to authenticated;

create policy agent_invocations_select_admin_only on public.agent_invocations for select using (public.is_admin());
create policy agent_messages_select_admin_only on public.agent_messages for select using (public.is_admin());

-- agent_idempotency_claims carries no content an admin needs to browse
-- (it is a pure concurrency-control ledger keyed by opaque strings) —
-- deliberately not even admin-readable via `authenticated`; service_role
-- only.

grant all on
  public.agent_invocations, public.agent_idempotency_claims, public.agent_messages
  to service_role;
