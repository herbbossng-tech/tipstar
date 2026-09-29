-- Agent framework test fixtures (Section 06, superuser, bypasses RLS).

insert into public.agent_invocations (id, agent_id, agent_type, agent_version, correlation_id, requested_by, side_effect_level, status, input_reference, output_reference, idempotency_key, completed_at) values
  ('f0000000-0000-0000-0000-000000000001', 'football-intelligence-agent', 'football_intelligence', '0.1.0', 'c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'analysis', 'completed', 'req-1', 'req-1', null, now());

insert into public.agent_messages (id, correlation_id, kind, message_type, schema_version, source_agent, target_agent, payload, idempotency_key) values
  ('ab000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'command', 'REQUEST_FOOTBALL_INTELLIGENCE', 1, 'system', 'football_intelligence', '{}', null);

insert into public.agent_idempotency_claims (agent_type, idempotency_key, invocation_id) values
  ('telegram_channel_management', 'publish-ticket-test-1', 'f0000000-0000-0000-0000-000000000001');
