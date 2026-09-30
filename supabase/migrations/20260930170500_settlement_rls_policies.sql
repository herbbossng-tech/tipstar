-- RLS policies and grants for the Section 08 settlement/performance/
-- backtesting schema. Same shape as every prior section's operational
-- tables (agent_invocations, market_observations, ...): internal engine/
-- orchestration records, no Mini App UI consumes them yet — every table
-- here is admin-only SELECT, never broad `authenticated` write access.
-- "Add only required database policies... operational settlement/
-- performance mutation should remain backend/service-role controlled...
-- do not create USING (true) write policies... never weaken Section 03/
-- 04/07 RLS." No INSERT/UPDATE/DELETE policy exists anywhere in this
-- file for anon/authenticated on any table; every write happens through
-- a service-role-backed repository (a later implementation task), never
-- a direct client write.

revoke all on
  public.settlements, public.settlement_legs, public.settlement_revisions,
  public.performance_ledger, public.backtest_runs, public.backtest_results
  from anon, authenticated;

grant select on
  public.settlements, public.settlement_legs, public.settlement_revisions,
  public.performance_ledger, public.backtest_runs, public.backtest_results
  to authenticated;

create policy settlements_select_admin_only on public.settlements for select using (public.is_admin());
create policy settlement_legs_select_admin_only on public.settlement_legs for select using (public.is_admin());
create policy settlement_revisions_select_admin_only on public.settlement_revisions for select using (public.is_admin());
create policy performance_ledger_select_admin_only on public.performance_ledger for select using (public.is_admin());
create policy backtest_runs_select_admin_only on public.backtest_runs for select using (public.is_admin());
create policy backtest_results_select_admin_only on public.backtest_results for select using (public.is_admin());

grant all on
  public.settlements, public.settlement_legs, public.settlement_revisions,
  public.performance_ledger, public.backtest_runs, public.backtest_results
  to service_role;
