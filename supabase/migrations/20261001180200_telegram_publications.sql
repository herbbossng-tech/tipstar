-- public.telegram_publications (Section 10 §21/§30/§49). The durable
-- publication record — one row per actual (or currently-retrying)
-- Telegram send attempt. A policy REJECT never reaches this table at
-- all (it is recorded only as an audit event, per
-- docs/architecture/PUBLISHING_POLICY.md) — every row here represents a
-- publication the policy engine already ALLOWed.
--
-- Mirrors PublicationRequest (packages/telegram/src/types.ts) plus the
-- outcome fields a request doesn't carry yet (status/telegram_message_id/
-- attempt_count/last_error).

create table public.telegram_publications (
  id uuid primary key default gen_random_uuid(),
  -- A reference to the authoritative source record — never a copy of
  -- its domain fields (probability, odds, stake, settlement result...).
  -- See PublicationRequest's own doc comment.
  source_type public.telegram_publication_source_type not null,
  source_id text not null,
  source_version integer not null,
  publication_type public.telegram_publishable_content_type not null,
  destination_id uuid not null references public.telegram_destinations (destination_id),
  status public.telegram_publication_status not null default 'PENDING',
  telegram_message_id bigint null,
  -- Set only for a RESULTS publication replying to the original
  -- ticket/pick message at this same destination (§22).
  reply_to_telegram_message_id bigint null,
  template_version text not null,
  policy_version text not null,
  requested_by uuid not null references public.users (id),
  -- Recorded for traceability/audit linkage only — the actual
  -- uniqueness GUARANTEE is the natural-key unique index below, not
  -- this column (mirrors how agent_invocations.idempotency_key is
  -- recorded while agent_idempotency_claims is what's actually
  -- enforced against).
  idempotency_key text not null,
  correlation_id uuid not null,
  attempt_count integer not null default 0,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'PUBLISHED') = (telegram_message_id is not null))
);

comment on table public.telegram_publications is
  'One row per publication attempt (Section 10). Written only through the service-role-backed TelegramPublicationsRepository in packages/agents/src/db/repositories.ts — never a direct client write. A retry updates the SAME row (attempt_count/status/last_error); it never inserts a second row for the same source+destination+type+version (see the unique index below).';

-- The idempotency boundary (§49): "source object + destination +
-- publication type + publication version." A retried publish for the
-- exact same (source_type, source_id, source_version, publication_type,
-- destination_id) tuple must resolve to this SAME row, never create a
-- second Telegram message.
create unique index telegram_publications_natural_key_idx
  on public.telegram_publications (source_type, source_id, source_version, publication_type, destination_id);

create index telegram_publications_destination_id_idx on public.telegram_publications (destination_id);
create index telegram_publications_source_idx on public.telegram_publications (source_type, source_id);
create index telegram_publications_correlation_id_idx on public.telegram_publications (correlation_id);
create index telegram_publications_status_idx on public.telegram_publications (status);

alter table public.telegram_publications enable row level security;
