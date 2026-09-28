-- RLS policies and grants for the Section 05 intelligence metadata
-- schema. Same shape as Section 04's operational tables
-- (data_sources/ingestion_runs/data_quarantine/data_conflicts): these
-- are internal ML-pipeline artifacts, not user-facing content, so every
-- table here is admin-only SELECT, never broad `authenticated` access
-- like Section 04's content tables (fixtures, match_results, ...).
-- "Operational/model-management tables must not become writable by
-- ordinary authenticated users. Service-role operations remain
-- server-only." — no INSERT/UPDATE/DELETE policy exists anywhere in
-- this file for authenticated/anon on any table.

revoke all on
  public.intelligence_dataset_versions, public.intelligence_model_versions,
  public.intelligence_calibration_versions, public.intelligence_ensemble_versions,
  public.intelligence_training_runs, public.intelligence_evaluation_runs
  from anon, authenticated;

grant select on
  public.intelligence_dataset_versions, public.intelligence_model_versions,
  public.intelligence_calibration_versions, public.intelligence_ensemble_versions,
  public.intelligence_training_runs, public.intelligence_evaluation_runs
  to authenticated;

create policy intelligence_dataset_versions_select_admin_only on public.intelligence_dataset_versions for select using (public.is_admin());
create policy intelligence_model_versions_select_admin_only on public.intelligence_model_versions for select using (public.is_admin());
create policy intelligence_calibration_versions_select_admin_only on public.intelligence_calibration_versions for select using (public.is_admin());
create policy intelligence_ensemble_versions_select_admin_only on public.intelligence_ensemble_versions for select using (public.is_admin());
create policy intelligence_training_runs_select_admin_only on public.intelligence_training_runs for select using (public.is_admin());
create policy intelligence_evaluation_runs_select_admin_only on public.intelligence_evaluation_runs for select using (public.is_admin());

grant all on
  public.intelligence_dataset_versions, public.intelligence_model_versions,
  public.intelligence_calibration_versions, public.intelligence_ensemble_versions,
  public.intelligence_training_runs, public.intelligence_evaluation_runs
  to service_role;
