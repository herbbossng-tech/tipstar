-- Section 10 — Telegram Bot, Multi-Channel Management & Automated
-- Publishing. Enum types mirroring @sport-os/telegram's own TypeScript
-- `as const` unions exactly (defense-in-depth mirror, same rationale as
-- every prior section's enums file — the TypeScript types in
-- packages/telegram/src/types.ts remain the single source of truth):
--   TelegramDestinationType               (extended this section with 'supergroup')
--   TelegramDestinationVerificationStatus (new this section)
--   PublicationSourceType                 (new this section)
--   PublishableContentType                (extended this section with 'pick')
--   TelegramPublicationStatus              (new this section)
--
-- public.agent_type already lists 'telegram_channel_management' (Section
-- 06) — not duplicated here.

create type public.telegram_destination_type as enum ('channel', 'group', 'supergroup', 'private');

create type public.telegram_destination_verification_status as enum ('unverified', 'verified', 'failed');

create type public.telegram_publication_source_type as enum ('TICKET', 'PICK', 'SETTLEMENT', 'PERFORMANCE');

create type public.telegram_publishable_content_type as enum ('booking_code', 'ticket', 'pick', 'results', 'weekly_report');

-- Deliberately four states, not the full textbook queue lifecycle — see
-- TelegramPublicationStatus's own doc comment in types.ts and
-- docs/architecture/TELEGRAM_PUBLISHING_ARCHITECTURE.md's "Why no job
-- queue."
create type public.telegram_publication_status as enum ('PENDING', 'RETRYING', 'PUBLISHED', 'FAILED');
