-- Section 08 (settlement/performance/backtesting) test fixtures
-- (superuser, bypasses RLS). Builds on the existing Section 07 pipeline
-- fixture (ticket 13000000-...-0001, ticket_legs 14000000-...-0001, both
-- against fixture f1000000-...-0001) from 90_section07_fixtures.sql, plus
-- one real match_results row this file adds so settlement_legs has a
-- genuine result version to reference.

insert into public.match_results (id, fixture_id, home_goals, away_goals, result_recorded_at, source) values
  ('19000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 2, 1, '2026-01-10T21:00:00Z', 'test_fixture_provider');

insert into public.settlements (id, ticket_id, ticket_version, status, settlement_policy_version, ledger_mode, actual_stake_amount, actual_stake_currency, actual_payout_amount, actual_payout_currency, payout_source, calculated_return_amount, calculated_return_currency, net_pnl_amount, net_pnl_currency, roi, settled_at, source, correlation_id) values
  ('1a000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', 1, 'WON', 'football-settlement-v1', 'LIVE', 10, 'NGN', 21, 'NGN', 'PROVIDER', null, null, 11, 'NGN', 1.1, '2026-01-10T21:05:00Z', 'settlement-agent', 'corr-1');

insert into public.settlement_legs (id, settlement_id, leg_id, fixture_id, market_type, selection, line, odds, status, result_version_id, reason) values
  ('1b000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'match_result_1x2', 'HOME', null, 2.10, 'WON', '19000000-0000-0000-0000-000000000001', 'Score 2-1 resolved to HOME.');

insert into public.settlement_revisions (id, original_settlement_id, previous_status, new_status, previous_payout_amount, previous_payout_currency, new_payout_amount, new_payout_currency, reason, source, result_version_id, idempotency_key, created_by) values
  ('1c000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000001', 'PENDING', 'WON', null, null, 21, 'NGN', 'Initial result became available.', 'settlement-agent', '19000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000001:19000000-0000-0000-0000-000000000001', 'system');

insert into public.performance_ledger (id, period_start, period_end, ledger_mode, sport, league, market, model_version, decision_policy_version, ticket_type, ticket_count, leg_count, executed_ticket_count, settled_ticket_count, wins, losses, voids, pushes, pending, actual_stake_amount, actual_stake_currency, actual_payout_amount, actual_payout_currency, actual_pnl_amount, actual_pnl_currency, roi, expected_ev, max_drawdown, longest_losing_streak, sample_size) values
  ('1d000000-0000-0000-0000-000000000001', '2026-01-01T00:00:00Z', '2026-01-31T23:59:59Z', 'LIVE', 'football', 'Premier League', 'match_result_1x2', 'test-model-v1', 'policy-test-v1', 'SINGLE', 1, 1, 1, 1, 1, 0, 0, 0, 0, 10, 'NGN', 21, 'NGN', 11, 'NGN', 1.1, 0.26, 0, 0, 1);

insert into public.backtest_runs (id, decision_policy_version, settlement_policy_version, stake_per_ticket, currency, status, started_at, completed_at) values
  ('1e000000-0000-0000-0000-000000000001', 'policy-test-v1', 'football-settlement-v1', 10, 'NGN', 'completed', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z');

insert into public.backtest_results (id, backtest_run_id, performance_ledger_id, sample_count, accuracy, log_loss, brier_score, clv_average, clv_sample_count, by_market, by_league) values
  ('1f000000-0000-0000-0000-000000000001', '1e000000-0000-0000-0000-000000000001', '1d000000-0000-0000-0000-000000000001', 100, 0.55, 0.68, 0.21, 0.02, 40, '{}', '{}');
