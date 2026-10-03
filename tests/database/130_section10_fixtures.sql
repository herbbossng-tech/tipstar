-- Section 10 (Telegram publishing) test fixtures (superuser, bypasses
-- RLS). One destination created by Adam (admin, 44444444-...-4444 from
-- 10_fixtures.sql) and one successful publication against it.

insert into public.telegram_destinations (destination_id, telegram_chat_id, name, type, enabled, auto_publish, publish_booking_code, publish_ticket, publish_results, publish_weekly_report, verification_status, verified_at, created_by) values
  ('d1000000-0000-0000-0000-000000000001', '-1001234567', 'Main Channel', 'channel', true, true, false, true, true, false, 'verified', '2026-01-10T19:00:00Z', '44444444-4444-4444-4444-444444444444');

insert into public.telegram_publications (id, source_type, source_id, source_version, publication_type, destination_id, status, telegram_message_id, template_version, policy_version, requested_by, idempotency_key, correlation_id, attempt_count) values
  ('e1000000-0000-0000-0000-000000000001', 'TICKET', '13000000-0000-0000-0000-000000000001', 1, 'ticket', 'd1000000-0000-0000-0000-000000000001', 'PUBLISHED', 555, 'ticket_v1', 'policy_v1', '11111111-1111-1111-1111-111111111111', 'TICKET:13000000-0000-0000-0000-000000000001:1:ticket:d1000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000001', 1);
