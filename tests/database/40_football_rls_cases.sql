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

-- ============================================================
-- FB TESTs 15-21: PR review fix — Match Result Correction Leakage /
-- Mutable Fixture Status Leakage. See leakage-guard.test.ts and
-- repositories.test.ts for the equivalent TypeScript-level regression
-- tests; these confirm the same point-in-time semantics hold at the
-- real Postgres schema level, not just in the in-memory test double.
-- ============================================================

\echo '--- FB TEST 15: anon cannot read fixture_status_observations (expect ERROR) ---'
begin;
set local role anon;
select id from public.fixture_status_observations;
rollback;

\echo '--- FB TEST 16: authenticated CAN read fixture_status_observations (expect >= 1 row, the seeded scheduled observation) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select status from public.fixture_status_observations where fixture_id = 'f1000000-0000-0000-0000-000000000001';
rollback;

\echo '--- FB TEST 17: authenticated user cannot insert a fixture status observation (expect ERROR) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
insert into public.fixture_status_observations (fixture_id, status, observed_at, provider)
values ('f1000000-0000-0000-0000-000000000001', 'finished', now(), 'attacker');
rollback;

\echo '--- FB TEST 18: service_role CAN insert a fixture status observation (real ingestion path; expect INSERT 1) ---'
begin;
set local role service_role;
insert into public.fixture_status_observations (fixture_id, status, provider_status_raw, observed_at, provider)
values ('f1000000-0000-0000-0000-000000000001', 'live', '1H', '2026-01-10T19:05:00Z', 'test_fixture_provider');
rollback;

\echo '--- FB TEST 19: MUTABLE FIXTURE STATUS LEAKAGE FIX — a point-in-time status query resolves scheduled/live/finished correctly by asOf, and a future status never appears in an earlier snapshot (expect scheduled, then live, then finished) ---'
begin;
set local role service_role;
insert into public.fixture_status_observations (fixture_id, status, provider_status_raw, observed_at, provider) values
  ('f1000000-0000-0000-0000-000000000001', 'live', '1H', '2026-01-10T19:05:00Z', 'test_fixture_provider'),
  ('f1000000-0000-0000-0000-000000000001', 'finished', 'FT', '2026-01-10T20:55:00Z', 'test_fixture_provider');

\echo '  pre-kickoff snapshot (18:00) — expect scheduled'
select status from public.fixture_status_observations
  where fixture_id = 'f1000000-0000-0000-0000-000000000001' and observed_at <= '2026-01-10T18:00:00Z'
  order by observed_at desc limit 1;

\echo '  in-play snapshot (19:30) — expect live, NOT finished'
select status from public.fixture_status_observations
  where fixture_id = 'f1000000-0000-0000-0000-000000000001' and observed_at <= '2026-01-10T19:30:00Z'
  order by observed_at desc limit 1;

\echo '  post-match snapshot (21:00) — expect finished'
select status from public.fixture_status_observations
  where fixture_id = 'f1000000-0000-0000-0000-000000000001' and observed_at <= '2026-01-10T21:00:00Z'
  order by observed_at desc limit 1;
rollback;

\echo '--- FB TEST 20: DB allows multiple match_results rows per fixture_id — the append-only-versions fix (expect 2 rows after two inserts; unique(fixture_id) has been removed) ---'
begin;
set local role service_role;
insert into public.match_results (fixture_id, home_goals, away_goals, result_recorded_at, source)
values ('f1000000-0000-0000-0000-000000000001', 1, 1, '2026-01-10T19:55:00Z', 'test_fixture_provider');
insert into public.match_results (fixture_id, home_goals, away_goals, result_recorded_at, source, corrected_at, correction_count)
values ('f1000000-0000-0000-0000-000000000001', 2, 1, '2026-01-10T20:30:00Z', 'test_fixture_provider', now(), 1);
select count(*) from public.match_results where fixture_id = 'f1000000-0000-0000-0000-000000000001';
rollback;

\echo '--- FB TEST 21: MATCH RESULT CORRECTION LEAKAGE FIX — a point-in-time result query resolves to the version known as of asOf, and a correction never leaks through an earlier snapshot (expect no row, then 1-1, then 2-1) ---'
begin;
set local role service_role;
insert into public.match_results (fixture_id, home_goals, away_goals, result_recorded_at, source) values
  ('f1000000-0000-0000-0000-000000000001', 1, 1, '2026-01-10T19:55:00Z', 'test_fixture_provider');
insert into public.match_results (fixture_id, home_goals, away_goals, result_recorded_at, source, corrected_at, correction_count) values
  ('f1000000-0000-0000-0000-000000000001', 2, 1, '2026-01-10T20:30:00Z', 'test_fixture_provider', now(), 1);

\echo '  pre-match snapshot (18:00) — expect 0 rows, the result is not yet known'
select home_goals, away_goals from public.match_results
  where fixture_id = 'f1000000-0000-0000-0000-000000000001' and result_recorded_at <= '2026-01-10T18:00:00Z'
  order by result_recorded_at desc limit 1;

\echo '  post-original, pre-correction snapshot (20:00) — expect 1-1, NOT the correction'
select home_goals, away_goals from public.match_results
  where fixture_id = 'f1000000-0000-0000-0000-000000000001' and result_recorded_at <= '2026-01-10T20:00:00Z'
  order by result_recorded_at desc limit 1;

\echo '  post-correction snapshot (21:00) — expect 2-1'
select home_goals, away_goals from public.match_results
  where fixture_id = 'f1000000-0000-0000-0000-000000000001' and result_recorded_at <= '2026-01-10T21:00:00Z'
  order by result_recorded_at desc limit 1;
rollback;

-- ============================================================
-- FB TESTs 22-27: PR review HARDENING fix — Atomic Fixture Upsert,
-- Deterministic Match-Result Version Ordering, Fixture Identity
-- Immutability. See repositories.test.ts and ingestion.test.ts for the
-- equivalent TypeScript-level regression tests; these confirm the same
-- guarantees hold against the real Postgres function/schema, not just
-- the in-memory test double.
-- ============================================================

\echo '--- FB TEST 22a: anon cannot execute upsert_fixture_with_status_observation (expect ERROR permission denied) ---'
begin;
set local role anon;
select public.upsert_fixture_with_status_observation(
  'c0000000-0000-0000-0000-000000000001', null,
  '7ea00000-0000-0000-0000-000000000001', '7ea00000-0000-0000-0000-000000000002',
  now(), 'scheduled', 'NS', 'test_fixture_provider', 'RPC-PERM-1', now());
rollback;

\echo '--- FB TEST 22b: authenticated cannot execute upsert_fixture_with_status_observation (expect ERROR permission denied) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select public.upsert_fixture_with_status_observation(
  'c0000000-0000-0000-0000-000000000001', null,
  '7ea00000-0000-0000-0000-000000000001', '7ea00000-0000-0000-0000-000000000002',
  now(), 'scheduled', 'NS', 'test_fixture_provider', 'RPC-PERM-2', now());
rollback;

\echo '--- FB TEST 23: service_role CAN atomically upsert a fixture + its status observation as one operation (expect status=scheduled, then 1 matching observation row) ---'
begin;
set local role service_role;
select status from public.upsert_fixture_with_status_observation(
  'c0000000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000001',
  '7ea00000-0000-0000-0000-000000000001', '7ea00000-0000-0000-0000-000000000002',
  '2026-04-01T19:00:00Z', 'scheduled', 'NS', 'test_fixture_provider', 'RPC-ATOMIC-1', '2026-03-25T00:00:00Z');
select count(*) from public.fixture_status_observations fso
  join public.fixtures f on f.id = fso.fixture_id
  where f.provider = 'test_fixture_provider' and f.provider_fixture_id = 'RPC-ATOMIC-1';
rollback;

\echo '--- FB TEST 24: ATOMIC FIXTURE UPSERT FIX — a failed status-observation write rolls back the fixtures write too, as one coherent operation (expect ERROR not-null violation, then 0 fixtures rows for ATOMIC-TEST-1) ---'
begin;
set local role service_role;
select * from public.upsert_fixture_with_status_observation(
  'c0000000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000001',
  '7ea00000-0000-0000-0000-000000000001', '7ea00000-0000-0000-0000-000000000002',
  '2026-01-10T19:00:00Z', 'scheduled', 'NS', 'test_fixture_provider', 'ATOMIC-TEST-1', null);
rollback;

begin;
set local role service_role;
select count(*) from public.fixtures where provider = 'test_fixture_provider' and provider_fixture_id = 'ATOMIC-TEST-1';
rollback;

\echo '--- FB TEST 25: DETERMINISTIC MATCH-RESULT VERSION ORDERING FIX — two versions sharing the exact same result_recorded_at resolve deterministically via version_seq (expect the later-inserted 3-3, consistently across repeated queries) ---'
begin;
set local role service_role;
insert into public.match_results (fixture_id, home_goals, away_goals, result_recorded_at, source) values
  ('f1000000-0000-0000-0000-000000000001', 1, 1, '2026-01-10T19:55:00Z', 'test_fixture_provider');
insert into public.match_results (fixture_id, home_goals, away_goals, result_recorded_at, source, corrected_at, correction_count) values
  ('f1000000-0000-0000-0000-000000000001', 3, 3, '2026-01-10T19:55:00Z', 'test_fixture_provider', now(), 1);

select home_goals, away_goals from public.match_results
  where fixture_id = 'f1000000-0000-0000-0000-000000000001' and result_recorded_at <= '2026-01-10T19:55:00Z'
  order by result_recorded_at desc, version_seq desc limit 1;

select home_goals, away_goals from public.match_results
  where fixture_id = 'f1000000-0000-0000-0000-000000000001' and result_recorded_at <= '2026-01-10T19:55:00Z'
  order by result_recorded_at desc, version_seq desc limit 1;
rollback;

\echo '--- FB TEST 26: FIXTURE IDENTITY IMMUTABILITY FIX — a repeat sighting reporting different home/away teams never rewrites the fixtures row (expect team ids unchanged on both reads; status legitimately updated to live) ---'
begin;
set local role service_role;
select home_team_id, away_team_id, status from public.upsert_fixture_with_status_observation(
  'c0000000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000001',
  '7ea00000-0000-0000-0000-000000000001', '7ea00000-0000-0000-0000-000000000002',
  '2026-04-02T19:00:00Z', 'scheduled', 'NS', 'test_fixture_provider', 'RPC-IDENTITY-1', '2026-03-25T00:00:00Z');

-- Repeat sighting, SAME provider_fixture_id, but swapped home/away teams
-- — must be silently ignored for identity, while status legitimately updates.
select home_team_id, away_team_id, status from public.upsert_fixture_with_status_observation(
  'c0000000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000001',
  '7ea00000-0000-0000-0000-000000000002', '7ea00000-0000-0000-0000-000000000001',
  '2026-04-02T19:00:00Z', 'live', '1H', 'test_fixture_provider', 'RPC-IDENTITY-1', '2026-04-02T19:05:00Z');
rollback;

\echo '--- FB TEST 27: an unchanged repeat sighting appends NO new fixture_status_observations row (expect 1 row total, not 2) ---'
begin;
set local role service_role;
select public.upsert_fixture_with_status_observation(
  'c0000000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000001',
  '7ea00000-0000-0000-0000-000000000001', '7ea00000-0000-0000-0000-000000000002',
  '2026-04-03T19:00:00Z', 'scheduled', 'NS', 'test_fixture_provider', 'RPC-NOCHANGE-1', '2026-03-25T00:00:00Z');
select public.upsert_fixture_with_status_observation(
  'c0000000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000001',
  '7ea00000-0000-0000-0000-000000000001', '7ea00000-0000-0000-0000-000000000002',
  '2026-04-03T19:00:00Z', 'scheduled', 'NS', 'test_fixture_provider', 'RPC-NOCHANGE-1', '2026-03-26T00:00:00Z');
select count(*) from public.fixture_status_observations fso
  join public.fixtures f on f.id = fso.fixture_id
  where f.provider = 'test_fixture_provider' and f.provider_fixture_id = 'RPC-NOCHANGE-1';
rollback;
