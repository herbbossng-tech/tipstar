\set ON_ERROR_STOP off

\echo '--- INTEL TEST 1: authenticated (non-admin) cannot read intelligence_model_versions (expect 0 rows) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select id from public.intelligence_model_versions;
rollback;

\echo '--- INTEL TEST 2: admin/owner CAN read intelligence_model_versions (expect 1 row) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select id from public.intelligence_model_versions;
rollback;

\echo '--- INTEL TEST 3: anon cannot read intelligence_model_versions at all (expect ERROR) ---'
begin;
set local role anon;
select id from public.intelligence_model_versions;
rollback;

\echo '--- INTEL TEST 4: authenticated user cannot INSERT an intelligence_model_versions row (expect ERROR) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
insert into public.intelligence_model_versions (model_family, model_version, training_dataset_version, feature_schema, random_seed, training_timestamp, state)
values ('neural_network', 'fake-v1', 'dataset-test-v1', '[]', 1, now(), '{}');
rollback;

\echo '--- INTEL TEST 5: service_role CAN insert an intelligence_model_versions row (real training path; expect INSERT 1) ---'
begin;
set local role service_role;
insert into public.intelligence_model_versions (model_family, model_version, training_dataset_version, feature_schema, random_seed, training_timestamp, state)
values ('neural_network', 'nn-v1', 'dataset-test-v1', '[]', 1, now(), '{}');
rollback;

\echo '--- INTEL TEST 6: DB rejects a duplicate (model_family, model_version) pair (expect ERROR unique_violation) ---'
begin;
insert into public.intelligence_model_versions (model_family, model_version, training_dataset_version, feature_schema, random_seed, training_timestamp, state)
values ('random_forest', 'rf-test-v1', 'dataset-test-v1', '[]', 1, now(), '{}');
rollback;

\echo '--- INTEL TEST 7: DB rejects a training run whose validation window starts before its training window ends (expect ERROR, check constraint) ---'
begin;
insert into public.intelligence_training_runs (model_version_id, train_start, train_end, validation_start, validation_end, test_start, test_end)
values ('a0000000-0000-0000-0000-000000000001', '2026-01-01T00:00:00Z', '2026-01-15T00:00:00Z', '2026-01-10T00:00:00Z', '2026-01-20T00:00:00Z', '2026-01-20T00:00:00Z', '2026-01-25T00:00:00Z');
rollback;

\echo '--- INTEL TEST 8: DB rejects a training run whose test window starts before its validation window ends (expect ERROR, check constraint) ---'
begin;
insert into public.intelligence_training_runs (model_version_id, train_start, train_end, validation_start, validation_end, test_start, test_end)
values ('a0000000-0000-0000-0000-000000000001', '2026-01-01T00:00:00Z', '2026-01-15T00:00:00Z', '2026-01-15T00:00:00Z', '2026-01-20T00:00:00Z', '2026-01-18T00:00:00Z', '2026-01-25T00:00:00Z');
rollback;

\echo '--- INTEL TEST 9: admin/owner CAN read intelligence_evaluation_runs (expect 1 row) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select id from public.intelligence_evaluation_runs;
rollback;

\echo '--- INTEL TEST 10: authenticated (non-admin) cannot read intelligence_calibration_versions (expect 0 rows) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select id from public.intelligence_calibration_versions;
rollback;

\echo '--- INTEL TEST 11: DB rejects a duplicate ensemble_version (expect ERROR unique_violation) ---'
begin;
insert into public.intelligence_ensemble_versions (ensemble_version, weight_source, weights, component_model_versions)
values ('ensemble-test-v1', 'learned', '{}', '{}');
rollback;

\echo '--- INTEL TEST 12: DB rejects a calibration_versions row whose training range is inverted (expect ERROR, check constraint) ---'
begin;
insert into public.intelligence_calibration_versions (calibrator_type, calibrator_version, training_range_start, training_range_end, input_model_version, calibration_dataset_version, state)
values ('isotonic', 'bad-range-v1', '2026-02-01T00:00:00Z', '2026-01-01T00:00:00Z', 'rf-test-v1', 'dataset-test-v1', '{}');
rollback;
