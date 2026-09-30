-- RLS policies and grants for the Section 07 decision/value/ticket/risk/
-- execution schema. Same shape as Section 06's agent-operational tables
-- (agent_invocations/agent_messages/agent_idempotency_claims): these are
-- internal engine/orchestration records, not yet exposed through any
-- Mini App UI (explicitly out of Section 07's scope) — every table here
-- is admin-only SELECT, never broad `authenticated` write access.
-- "Database... RLS required, never broad authenticated write, never
-- weaken existing RLS." No INSERT/UPDATE/DELETE policy exists anywhere
-- in this file for anon/authenticated on any table; every write happens
-- through a service-role-backed repository (a later implementation
-- task), never a direct client write — exactly like every prior
-- section's operational tables.

revoke all on
  public.market_observations, public.value_evaluations, public.tickets,
  public.ticket_status_history, public.ticket_legs, public.risk_evaluations,
  public.decisions, public.execution_requests, public.execution_results
  from anon, authenticated;

grant select on
  public.market_observations, public.value_evaluations, public.tickets,
  public.ticket_status_history, public.ticket_legs, public.risk_evaluations,
  public.decisions, public.execution_requests, public.execution_results
  to authenticated;

create policy market_observations_select_admin_only on public.market_observations for select using (public.is_admin());
create policy value_evaluations_select_admin_only on public.value_evaluations for select using (public.is_admin());
create policy tickets_select_admin_only on public.tickets for select using (public.is_admin());
create policy ticket_status_history_select_admin_only on public.ticket_status_history for select using (public.is_admin());
create policy ticket_legs_select_admin_only on public.ticket_legs for select using (public.is_admin());
create policy risk_evaluations_select_admin_only on public.risk_evaluations for select using (public.is_admin());
create policy decisions_select_admin_only on public.decisions for select using (public.is_admin());
create policy execution_requests_select_admin_only on public.execution_requests for select using (public.is_admin());
create policy execution_results_select_admin_only on public.execution_results for select using (public.is_admin());

grant all on
  public.market_observations, public.value_evaluations, public.tickets,
  public.ticket_status_history, public.ticket_legs, public.risk_evaluations,
  public.decisions, public.execution_requests, public.execution_results
  to service_role;
