-- Section 07 (decision/value/ticket/risk/execution) test fixtures
-- (superuser, bypasses RLS). Builds one full pipeline instance atop the
-- existing football fixture FIX-1 (f1000000-...-0001) and user Alice
-- (11111111-...-1111) from 10_fixtures.sql/30_football_fixtures.sql.

insert into public.market_observations (id, fixture_id, market_type, selection, odds, odds_timestamp, source, status) values
  ('11000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'match_result_1x2', 'HOME', 2.10, '2026-01-10T18:59:00Z', 'test_bookmaker', 'open');

insert into public.value_evaluations (id, fixture_id, market_type, selection, calibrated_probability, market_odds, fair_odds, edge, expected_value, data_quality, odds_timestamp, model_version, calculation_version, eligibility, decision, reasons, qualifies, evaluated_at) values
  ('12000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'match_result_1x2', 'HOME', 0.6, 2.10, 1.6667, 0.1238, 0.26, 'AVAILABLE', '2026-01-10T18:59:00Z', 'test-model-v1', 'value-engine-v1', 'valid', 'BET', '{}', true, '2026-01-10T19:00:00Z');

insert into public.tickets (id, ticket_type, combined_odds, combined_probability, combined_probability_method, combined_probability_calculation_version, version, status, created_by, idempotency_key) values
  ('13000000-0000-0000-0000-000000000001', 'SINGLE', 2.10, 0.6, 'independence_assumption', 'combined-probability-v1-independence-assumption', 1, 'DRAFT', '11111111-1111-1111-1111-111111111111', 'section07-ticket-fixture-1');

insert into public.ticket_status_history (ticket_id, version, status, transitioned_at) values
  ('13000000-0000-0000-0000-000000000001', 1, 'DRAFT', '2026-01-10T19:00:00Z');

insert into public.ticket_legs (id, ticket_id, fixture_id, market_type, selection, probability, odds, fair_odds, expected_value, edge, model_version, calculation_version, value_evaluated_at) values
  ('14000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'match_result_1x2', 'HOME', 0.6, 2.10, 1.6667, 0.26, 0.1238, 'test-model-v1', 'value-engine-v1', '2026-01-10T19:00:00Z');

insert into public.risk_evaluations (id, ticket_id, risk_code, reasons, approved, reason, proposed_stake, projected_daily_stake, projected_daily_ticket_count, policy_version, evaluated_at) values
  ('15000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', 'APPROVED', '{}', true, 'Ticket satisfies every configured risk limit.', 10, 10, 1, 'risk-policy-fixture-v1', '2026-01-10T19:01:00Z');

insert into public.decisions (id, value_evaluation_id, risk_evaluation_id, ticket_id, outcome, reasons, qualifies, requested_by, decided_at) values
  ('16000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000001', '15000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', 'BET', '{}', true, '11111111-1111-1111-1111-111111111111', '2026-01-10T19:01:30Z');

insert into public.execution_requests (id, ticket_id, ticket_or_signal_id, requested_by, execution_mode, stake, market_type, selection, odds, idempotency_key, user_confirmed, gate_authorized) values
  ('17000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'assisted', 10, 'match_result_1x2', 'HOME', 2.10, 'section07-exec-fixture-1', true, false);

insert into public.execution_results (id, execution_request_id, status) values
  ('18000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000001', 'NOT_AVAILABLE');
