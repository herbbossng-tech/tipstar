-- RLS policies and grants for the Section 04 football data schema.
--
-- Shape, consistent with Section 03: no policy for an operation means
-- that operation is fully denied for that role once RLS is enabled.
-- service_role (bypasses RLS) is the only role that ever writes to any
-- table here — ingestion is a trusted backend operation, never
-- client-initiated. This directly satisfies "Users should not be able
-- to: modify fixtures, modify results, modify historical odds, modify
-- provider provenance, insert fake match results."
--
-- Defensive baseline first (same reasoning as Section 03's RLS policies
-- migration: this repo's local test harness cannot fully replicate
-- Supabase's managed-instance default privilege scheme).
revoke all on
  public.data_sources, public.competitions, public.seasons, public.venues, public.teams,
  public.fixtures, public.match_results, public.match_events, public.team_observations,
  public.odds_observations, public.fixture_status_observations, public.ingestion_runs,
  public.data_quarantine, public.data_conflicts
  from anon, authenticated;

-- ============================================================
-- Platform content tables: readable by authenticated once a Supabase
-- Auth bridge exists (see docs/architecture/DATABASE_AND_RLS.md's "RLS
-- identity helper" — not yet reachable from live traffic, same gap
-- Section 03 documented). Never readable by anon. This is a baseline,
-- not the live enforcement point — an entitlement check
-- (football_analysis) happens at the application layer in the Edge
-- Function that actually serves this data today.
-- ============================================================

grant select on public.competitions, public.seasons, public.venues, public.teams, public.fixtures, public.match_results, public.match_events, public.team_observations, public.odds_observations, public.fixture_status_observations
  to authenticated;

create policy competitions_select_authenticated on public.competitions for select using (true);
create policy seasons_select_authenticated on public.seasons for select using (true);
create policy venues_select_authenticated on public.venues for select using (true);
create policy teams_select_authenticated on public.teams for select using (true);
create policy fixtures_select_authenticated on public.fixtures for select using (true);
create policy match_results_select_authenticated on public.match_results for select using (true);
create policy match_events_select_authenticated on public.match_events for select using (true);
create policy team_observations_select_authenticated on public.team_observations for select using (true);
create policy odds_observations_select_authenticated on public.odds_observations for select using (true);
create policy fixture_status_observations_select_authenticated on public.fixture_status_observations for select using (true);

-- ============================================================
-- Operational/internal tables: admin-only SELECT, never anon/plain-user.
-- ============================================================

grant select on public.data_sources, public.ingestion_runs, public.data_quarantine, public.data_conflicts to authenticated;

create policy data_sources_select_admin_only on public.data_sources for select using (public.is_admin());
create policy ingestion_runs_select_admin_only on public.ingestion_runs for select using (public.is_admin());
create policy data_quarantine_select_admin_only on public.data_quarantine for select using (public.is_admin());
create policy data_conflicts_select_admin_only on public.data_conflicts for select using (public.is_admin());

-- No INSERT/UPDATE/DELETE policy exists anywhere in this file for
-- authenticated/anon on any table — ingestion, corrections, and
-- quarantine/conflict resolution are exclusively service-role
-- operations (see @sport-os/football-engine's repositories).

-- ============================================================
-- service_role — explicit full grant, matching Section 03's rationale
-- (a hosted Supabase project grants this by default; this repo's local
-- test harness defines service_role itself and does not inherit that).
-- ============================================================

grant all on
  public.data_sources, public.competitions, public.seasons, public.venues, public.teams,
  public.fixtures, public.match_results, public.match_events, public.team_observations,
  public.odds_observations, public.fixture_status_observations, public.ingestion_runs,
  public.data_quarantine, public.data_conflicts
  to service_role;
