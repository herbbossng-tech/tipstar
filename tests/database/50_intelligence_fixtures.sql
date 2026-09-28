-- Intelligence metadata test fixtures (Section 05, superuser, bypasses RLS).

insert into public.intelligence_dataset_versions (id, dataset_version, snapshot_lead_time_minutes, competition_ids, sample_count, excluded_count, built_at) values
  ('da000000-0000-0000-0000-000000000001', 'dataset-test-v1', 60, null, 100, 5, now());

insert into public.intelligence_model_versions (id, model_family, model_version, training_dataset_version, feature_schema, hyperparameters, random_seed, training_timestamp, state) values
  ('a0000000-0000-0000-0000-000000000001', 'random_forest', 'rf-test-v1', 'dataset-test-v1', '["elo_rating_diff"]', '{"numTrees": 10, "maxDepth": 3}', 42, now(), '{"forests": {}}');

insert into public.intelligence_calibration_versions (id, calibrator_type, calibrator_version, training_range_start, training_range_end, input_model_version, calibration_dataset_version, validation_log_loss, state) values
  ('ca000000-0000-0000-0000-000000000001', 'platt', 'platt-test-v1', '2026-01-01T00:00:00Z', '2026-01-31T00:00:00Z', 'rf-test-v1', 'dataset-test-v1', 0.65, '{"perClass": {}}');

insert into public.intelligence_ensemble_versions (id, ensemble_version, weight_source, weights, component_model_versions) values
  ('e5000000-0000-0000-0000-000000000001', 'ensemble-test-v1', 'configured_baseline', '{"elo": 0.5, "poisson": 0.5}', '{"elo": "elo-baseline-v1", "poisson": "poisson-v1"}');

insert into public.intelligence_evaluation_runs (id, model_version_id, dataset_version, sample_count, accuracy, log_loss, brier_score, expected_calibration_error, missing_feature_rate, data_quality_distribution, calibration_buckets, by_competition, by_season, evaluated_at) values
  ('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'dataset-test-v1', 100, 0.5, 1.0, 0.6, 0.1, 0.05, '{}', '[]', '{}', '{}', now());

insert into public.intelligence_training_runs (id, model_version_id, status, train_start, train_end, validation_start, validation_end, test_start, test_end) values
  ('7c000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'completed', '2026-01-01T00:00:00Z', '2026-01-15T00:00:00Z', '2026-01-15T00:00:00Z', '2026-01-20T00:00:00Z', '2026-01-20T00:00:00Z', '2026-01-25T00:00:00Z');
