-- Football data test fixtures (superuser, bypasses RLS).

insert into public.data_sources (provider, display_name, kind, enabled) values
  ('test_fixture_provider', 'Test Fixture Provider', 'football_data', true);

insert into public.competitions (id, provider, provider_competition_id, name, country, competition_type) values
  ('c0000000-0000-0000-0000-000000000001', 'test_fixture_provider', 'PL', 'Premier League', 'England', 'league');

insert into public.seasons (id, competition_id, provider, provider_season_id, name, start_date, end_date, status) values
  ('5e000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'test_fixture_provider', '2026', '2025/2026', '2025-08-01', '2026-05-31', 'active');

insert into public.teams (id, provider, provider_team_id, name, short_name, country) values
  ('7ea00000-0000-0000-0000-000000000001', 'test_fixture_provider', 'ARS', 'Arsenal', 'ARS', 'England'),
  ('7ea00000-0000-0000-0000-000000000002', 'test_fixture_provider', 'CHE', 'Chelsea', 'CHE', 'England');

insert into public.fixtures (id, competition_id, season_id, home_team_id, away_team_id, scheduled_kickoff_at, status, provider, provider_fixture_id) values
  ('f1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000001', '7ea00000-0000-0000-0000-000000000001', '7ea00000-0000-0000-0000-000000000002', '2026-01-10T19:00:00Z', 'scheduled', 'test_fixture_provider', 'FIX-1');

insert into public.ingestion_runs (id, provider, mode, status, started_at, completed_at, records_received, records_inserted) values
  ('9000000a-0000-0000-0000-000000000001', 'test_fixture_provider', 'backfill', 'completed', now(), now(), 1, 1);

insert into public.odds_observations (fixture_id, market_type, selection, odds, bookmaker_source, observed_at, temporal_reliability, provider, ingestion_run_id) values
  ('f1000000-0000-0000-0000-000000000001', 'match_result_1x2', 'home', 2.10, 'test_bookmaker', '2026-01-10T17:45:00Z', 'confirmed', 'test_fixture_provider', '9000000a-0000-0000-0000-000000000001');
