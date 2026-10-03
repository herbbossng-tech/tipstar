-- public.telegram_destinations (Section 10 §8). Canonical field list is
-- LOCKED to exactly what TelegramDestination
-- (packages/telegram/src/types.ts) declares, plus the Section 10
-- verification fields it already carries and the operational
-- created_by/updated_at columns every other section's tables use for
-- audit — no unrelated business field is added here. See
-- docs/architecture/TELEGRAM_DESTINATIONS.md.

create table public.telegram_destinations (
  destination_id uuid primary key default gen_random_uuid(),
  -- Telegram chat ids for channels/supergroups are negative numbers that
  -- can exceed a signed 32-bit range; stored as text to mirror
  -- TelegramDestination.telegramChatId's own `string` type exactly and
  -- avoid any lossy numeric round-trip.
  telegram_chat_id text not null,
  name text not null,
  type public.telegram_destination_type not null,
  enabled boolean not null default true,
  auto_publish boolean not null default false,
  publish_booking_code boolean not null default false,
  publish_ticket boolean not null default true,
  publish_results boolean not null default true,
  publish_weekly_report boolean not null default false,
  -- "A destination is never marked VERIFIED just because a chat id was
  -- typed in" (§10) — defaults to the fail-closed 'unverified' state.
  verification_status public.telegram_destination_verification_status not null default 'unverified',
  verified_at timestamptz null,
  created_by uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((verification_status = 'verified') = (verified_at is not null))
);

comment on table public.telegram_destinations is
  'One row per configured Telegram publishing destination (Section 10). Mutated only through the service-role-backed destination manager in packages/agents/src/db/repositories.ts after its own OWNER/ADMIN authorization check — never a direct client write (see telegram RLS policies migration).';

-- One destination per chat: prevents two destination rows from
-- independently targeting the same chat (which would double-publish to
-- it under multi-channel fanout, each counted as a separate successful
-- delivery).
create unique index telegram_destinations_telegram_chat_id_idx on public.telegram_destinations (telegram_chat_id);
create index telegram_destinations_enabled_idx on public.telegram_destinations (enabled);
create index telegram_destinations_created_by_idx on public.telegram_destinations (created_by);

alter table public.telegram_destinations enable row level security;
