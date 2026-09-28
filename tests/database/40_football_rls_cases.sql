\set ON_ERROR_STOP off

\echo '--- FB TEST 1: authenticated user can read fixtures (expect 1 row) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select id, status from public.fixtures where id = 'f1000000-0000-0000-0000-000000000001';
rollback;

\echo '--- FB TEST 2: anon cannot read fixtures at all (expect ERROR) ---'
begin;
set local role anon;
select id from public.fixtures;
rollback;

\echo '--- FB TEST 3: authenticated user cannot INSERT a fixture (expect ERROR) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
insert into public.fixtures (competition_id, home_team_id, away_team_id, scheduled_kickoff_at, provider, provider_fixture_id)
values ('c0000000-0000-0000-0000-000000000001', '7ea00000-0000-0000-0000-000000000001', '7ea00000-0000-0000-0000-000000000002', now(), 'test_fixture_provider', 'FAKE-1');
rollback;

\echo '--- FB TEST 4: authenticated user cannot UPDATE a fixture status (expect UPDATE 0, no policy grants it) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
update public.fixtures set status = 'finished' where id = 'f1000000-0000-0000-0000-000000000001';
rollback;

\echo '--- FB TEST 5: authenticated user cannot insert a fake match result (expect ERROR) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
insert into public.match_results (fixture_id, home_goals, away_goals, result_recorded_at, source)
values ('f1000000-0000-0000-0000-000000000001', 5, 0, now(), 'fabricated');
rollback;

\echo '--- FB TEST 6: authenticated user cannot modify historical odds (expect ERROR on insert) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
insert into public.odds_observations (fixture_id, market_type, selection, odds, bookmaker_source, observed_at, temporal_reliability, provider)
values ('f1000000-0000-0000-0000-000000000001', 'match_result_1x2', 'home', 999, 'fake', now(), 'estimated', 'attacker');
rollback;

\echo '--- FB TEST 7: authenticated (non-admin) cannot read ingestion_runs (expect 0 rows) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select id from public.ingestion_runs;
rollback;

\echo '--- FB TEST 8: admin/owner CAN read ingestion_runs (expect 1 row) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select id from public.ingestion_runs;
rollback;

\echo '--- FB TEST 9: service_role CAN insert a fixture (real ingestion path; expect INSERT 1) ---'
begin;
set local role service_role;
insert into public.fixtures (competition_id, home_team_id, away_team_id, scheduled_kickoff_at, provider, provider_fixture_id)
values ('c0000000-0000-0000-0000-000000000001', '7ea00000-0000-0000-0000-000000000001', '7ea00000-0000-0000-0000-000000000002', now(), 'test_fixture_provider', 'FIX-2');
rollback;

\echo '--- FB TEST 10: DB rejects a fixture with the same team as home and away (expect ERROR, check constraint) ---'
begin;
insert into public.fixtures (competition_id, home_team_id, away_team_id, scheduled_kickoff_at, provider, provider_fixture_id)
values ('c0000000-0000-0000-0000-000000000001', '7ea00000-0000-0000-0000-000000000001', '7ea00000-0000-0000-0000-000000000001', now(), 'test_fixture_provider', 'FIX-SAME');
rollback;

\echo '--- FB TEST 11: DB rejects a duplicate (provider, provider_fixture_id) (expect ERROR unique_violation) ---'
begin;
insert into public.fixtures (competition_id, home_team_id, away_team_id, scheduled_kickoff_at, provider, provider_fixture_id)
values ('c0000000-0000-0000-0000-000000000001', '7ea00000-0000-0000-0000-000000000001', '7ea00000-0000-0000-0000-000000000002', now(), 'test_fixture_provider', 'FIX-1');
rollback;

\echo '--- FB TEST 12: DB rejects a negative goal count (expect ERROR, check constraint) ---'
begin;
insert into public.match_results (fixture_id, home_goals, away_goals, result_recorded_at, source)
values ('f1000000-0000-0000-0000-000000000001', -1, 2, now(), 'test_fixture_provider');
rollback;

\echo '--- FB TEST 13: DB rejects non-positive odds (expect ERROR, check constraint) ---'
begin;
insert into public.odds_observations (fixture_id, market_type, selection, odds, bookmaker_source, observed_at, temporal_reliability, provider)
values ('f1000000-0000-0000-0000-000000000001', 'match_result_1x2', 'home', 0, 'test_bookmaker', now(), 'confirmed', 'test_fixture_provider');
rollback;

\echo '--- FB TEST 14: multiple odds observations for the same fixture/market/selection are all preserved (expect 2 rows after two inserts) ---'
begin;
insert into public.odds_observations (fixture_id, market_type, selection, odds, bookmaker_source, observed_at, temporal_reliability, provider)
values ('f1000000-0000-0000-0000-000000000001', 'match_result_1x2', 'home', 2.20, 'test_bookmaker', '2026-01-10T18:30:00Z', 'confirmed', 'test_fixture_provider');
select count(*) from public.odds_observations where fixture_id = 'f1000000-0000-0000-0000-000000000001' and market_type = 'match_result_1x2' and selection = 'home';
rollback;
