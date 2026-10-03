\set ON_ERROR_STOP off

\echo '--- SECTION10 TEST 1: authenticated (non-admin) cannot read telegram_destinations (expect 0 rows) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select destination_id from public.telegram_destinations;
rollback;

\echo '--- SECTION10 TEST 2: admin CAN read telegram_destinations (expect 1 row) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444"}';
select destination_id from public.telegram_destinations;
rollback;

\echo '--- SECTION10 TEST 3: anon cannot read telegram_destinations at all (expect ERROR) ---'
begin;
set local role anon;
select destination_id from public.telegram_destinations;
rollback;

\echo '--- SECTION10 TEST 4: authenticated (non-admin) cannot INSERT a destination (expect ERROR) — frontend is not security ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
insert into public.telegram_destinations (telegram_chat_id, name, type, created_by)
values ('-999', 'Rogue Channel', 'channel', '11111111-1111-1111-1111-111111111111');
rollback;

\echo '--- SECTION10 TEST 5: admin authenticated ALSO cannot INSERT directly — only the service-role-backed destination manager writes (expect ERROR) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444"}';
insert into public.telegram_destinations (telegram_chat_id, name, type, created_by)
values ('-998', 'Admin Direct Insert', 'channel', '44444444-4444-4444-4444-444444444444');
rollback;

\echo '--- SECTION10 TEST 6: service_role CAN insert a destination (the real repository path; expect INSERT 1) ---'
begin;
set local role service_role;
insert into public.telegram_destinations (telegram_chat_id, name, type, created_by)
values ('-1009999', 'Service Role Channel', 'channel', '44444444-4444-4444-4444-444444444444');
rollback;

\echo '--- SECTION10 TEST 7: DB rejects a second destination pointed at the same telegram_chat_id (expect ERROR unique_violation) ---'
begin;
insert into public.telegram_destinations (telegram_chat_id, name, type, created_by)
values ('-1001234567', 'Duplicate Of Main Channel', 'channel', '44444444-4444-4444-4444-444444444444');
rollback;

\echo '--- SECTION10 TEST 8: DB rejects verification_status=verified with no verified_at (expect ERROR check constraint) ---'
begin;
insert into public.telegram_destinations (telegram_chat_id, name, type, created_by, verification_status, verified_at)
values ('-1005555', 'Falsely Verified Channel', 'channel', '44444444-4444-4444-4444-444444444444', 'verified', null);
rollback;

\echo '--- SECTION10 TEST 9: authenticated (non-admin) cannot UPDATE a destination (expect ERROR) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
update public.telegram_destinations set enabled = false where destination_id = 'd1000000-0000-0000-0000-000000000001';
rollback;

\echo '--- SECTION10 TEST 10: service_role CAN update a destination (expect UPDATE 1) ---'
begin;
set local role service_role;
update public.telegram_destinations set enabled = false where destination_id = 'd1000000-0000-0000-0000-000000000001';
rollback;

\echo '--- SECTION10 TEST 11: authenticated (non-admin) cannot read telegram_publications (expect 0 rows) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select id from public.telegram_publications;
rollback;

\echo '--- SECTION10 TEST 12: admin CAN read telegram_publications (expect 1 row) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444"}';
select id from public.telegram_publications;
rollback;

\echo '--- SECTION10 TEST 13: authenticated user cannot INSERT a fake publication record (expect ERROR) — never trust a client-asserted telegram_message_id ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
insert into public.telegram_publications (source_type, source_id, source_version, publication_type, destination_id, status, telegram_message_id, template_version, policy_version, requested_by, idempotency_key, correlation_id)
values ('TICKET', '13000000-0000-0000-0000-000000000001', 99, 'ticket', 'd1000000-0000-0000-0000-000000000001', 'PUBLISHED', 1, 'ticket_v1', 'policy_v1', '11111111-1111-1111-1111-111111111111', 'fake-key', '16000000-0000-0000-0000-000000000001');
rollback;

\echo '--- SECTION10 TEST 14: service_role CAN insert a publication (the real repository path; expect INSERT 1) ---'
begin;
set local role service_role;
insert into public.telegram_publications (source_type, source_id, source_version, publication_type, destination_id, status, telegram_message_id, template_version, policy_version, requested_by, idempotency_key, correlation_id)
values ('TICKET', '13000000-0000-0000-0000-000000000002', 1, 'ticket', 'd1000000-0000-0000-0000-000000000001', 'PUBLISHED', 777, 'ticket_v1', 'policy_v1', '11111111-1111-1111-1111-111111111111', 'new-key', '16000000-0000-0000-0000-000000000001');
rollback;

\echo '--- SECTION10 TEST 15: DB rejects a duplicate (source_type, source_id, source_version, publication_type, destination_id) tuple — the real idempotency boundary (expect ERROR unique_violation) ---'
begin;
insert into public.telegram_publications (source_type, source_id, source_version, publication_type, destination_id, status, telegram_message_id, template_version, policy_version, requested_by, idempotency_key, correlation_id)
values ('TICKET', '13000000-0000-0000-0000-000000000001', 1, 'ticket', 'd1000000-0000-0000-0000-000000000001', 'PUBLISHED', 888, 'ticket_v1', 'policy_v1', '11111111-1111-1111-1111-111111111111', 'retry-key', '16000000-0000-0000-0000-000000000001');
rollback;

\echo '--- SECTION10 TEST 16: DB rejects status=PUBLISHED with no telegram_message_id — never a fabricated success (expect ERROR check constraint) ---'
begin;
insert into public.telegram_publications (source_type, source_id, source_version, publication_type, destination_id, status, telegram_message_id, template_version, policy_version, requested_by, idempotency_key, correlation_id)
values ('TICKET', '13000000-0000-0000-0000-000000000003', 1, 'ticket', 'd1000000-0000-0000-0000-000000000001', 'PUBLISHED', null, 'ticket_v1', 'policy_v1', '11111111-1111-1111-1111-111111111111', 'no-message-id-key', '16000000-0000-0000-0000-000000000001');
rollback;

\echo '--- SECTION10 TEST 17: a PENDING publication with no telegram_message_id yet is allowed (expect INSERT 1) ---'
begin;
insert into public.telegram_publications (source_type, source_id, source_version, publication_type, destination_id, status, telegram_message_id, template_version, policy_version, requested_by, idempotency_key, correlation_id)
values ('TICKET', '13000000-0000-0000-0000-000000000004', 1, 'ticket', 'd1000000-0000-0000-0000-000000000001', 'PENDING', null, 'ticket_v1', 'policy_v1', '11111111-1111-1111-1111-111111111111', 'pending-key', '16000000-0000-0000-0000-000000000001');
rollback;

\echo '--- SECTION10 TEST 18: authenticated user cannot UPDATE a publication status (expect ERROR) — never let a client mark its own publication PUBLISHED ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
update public.telegram_publications set status = 'FAILED' where id = 'e1000000-0000-0000-0000-000000000001';
rollback;
