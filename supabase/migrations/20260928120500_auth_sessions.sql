-- public.auth_sessions — Section 03 Session Architecture decision (see
-- docs/architecture/TELEGRAM_AUTHENTICATION.md's "Session architecture
-- (Section 03 update)" and docs/architecture/AUTHORIZATION.md).
--
-- Hybrid model: Section 02's stateless HMAC-signed token format is
-- unchanged (issueAuthSession()/verifyAuthSession() in
-- @sport-os/telegram still work exactly as before — no Section 02
-- contract was touched). This table adds a persistence layer ON TOP of
-- that token for revocation and observability: session_id matches the
-- sessionId embedded in the token's signed payload, and token_hash is a
-- SHA-256 digest of the full token string — NEVER the raw token itself,
-- per the spec's explicit "NEVER store raw bearer/session tokens."

create table public.auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  session_id uuid not null unique,
  token_hash text not null unique,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  revoked_reason text null,
  created_at timestamptz not null default now()
);

comment on table public.auth_sessions is
  'Persistence layer over Section 02''s stateless session tokens, added for revocation/observability. token_hash = sha256(token) — the raw token is never written here. A token is honored only if its HMAC signature AND freshness both verify (Section 02, unchanged) AND its auth_sessions row exists with revoked_at IS NULL AND expires_at > now().';

create index auth_sessions_user_id_idx on public.auth_sessions (user_id);
create index auth_sessions_expires_at_idx on public.auth_sessions (expires_at);

alter table public.auth_sessions enable row level security;
