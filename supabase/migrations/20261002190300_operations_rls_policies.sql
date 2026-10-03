-- RLS policies and grants for the Section 11 operations schema
-- (operational_jobs, weekly_reports). Same shape as every prior
-- section's operational tables: admin-only SELECT, service_role
-- write-only, no `USING (true)` policy anywhere, no INSERT/UPDATE/
-- DELETE policy for anon/authenticated on either table. Every write
-- happens through the service-role-backed `SupabaseOperationalJobsRepository`/
-- `SupabaseWeeklyReportsRepository` (packages/agents/src/db/
-- repositories.ts) or the `claim_next_operational_job()` function
-- (service_role-only EXECUTE) — never a direct client write.

revoke all on
  public.operational_jobs, public.weekly_reports
  from anon, authenticated;

grant select on
  public.operational_jobs, public.weekly_reports
  to authenticated;

create policy operational_jobs_select_admin_only on public.operational_jobs for select using (public.is_admin());
create policy weekly_reports_select_admin_only on public.weekly_reports for select using (public.is_admin());

grant all on
  public.operational_jobs, public.weekly_reports
  to service_role;
