# Database Conventions

Schema lives in `supabase/migrations/`. Section 01 shipped
`20260919000000_init_schema.sql`; Section 02 adds
`20260921000000_telegram_session_upsert.sql` (the `upsert_telegram_user`
function backing `supabase/functions/telegram-init-auth` — see
`docs/architecture/telegram-security.md`). Never edit a shipped
migration — add a new one.

## Conventions

- Primary keys: `uuid primary key default gen_random_uuid()`.
- Timestamps: `timestamptz`, defaulting to `now()` where the row records
  "when this happened" (e.g. `published_at`, `occurred_at`).
- Enums (`user_status`, `sport`, `decision_status`, ...) mirror the union
  types in `packages/types` exactly — if you add a value to one, add it to
  both, in the same PR.
- `jsonb` is used only for genuinely flexible structured data (evidence
  packages, decision reasons, provider raw payloads) — never as a
  substitute for a normalized column that always has the same shape.
- Every foreign key has a matching index for the join direction the
  application actually queries (see the `idx_*` indexes on `picks`,
  `sport_events`, `intelligence_results`, `subscriptions`,
  `referral_attributions`, `audit_log`).

## Enforcing invariants at the database layer, not just in application code

Two triggers exist specifically because "the app will always call the
right function" is not a safety guarantee:

- `enforce_pick_immutability()` on `picks`: rejects any `UPDATE` that
  changes a pick's identity fields, and rejects moving
  `settlement_status` from `settled` back to `unsettled`.
- `forbid_mutation()` on `pick_corrections` and `audit_log`: both are
  append-only ledgers; `UPDATE`/`DELETE` always raises.

## Row Level Security

RLS is enabled on every user-facing table. The policies key off
`tipstar_auth_user_id()`, a SQL function reading a `tipstar_user_id` claim
from the request JWT — a claim the backend only ever sets **after**
validating Telegram `initData` server-side (see
`docs/architecture/telegram-security.md`). No policy trusts a
client-supplied user id column directly.

- `users`, `telegram_identities`, `notification_preferences`,
  `user_sport_preferences`, `subscriptions`, `referral_attributions`:
  readable/writable only by their owning user.
- `picks` and `pick_corrections`: publicly readable (they are the core
  product — paywall/entitlement gating happens in the API layer, not
  RLS), but have **no** insert/update/delete policy, so only the
  service role can write them.
- `intelligence_results`, `decision_outcomes`, `audit_log`: **no**
  policies at all yet — inaccessible to anon/authenticated roles, visible
  only via the service role. A future admin API can add a scoped policy
  keyed off `user_roles` once that surface exists.

## Server-side functions

`upsert_telegram_user(...)` (Section 02) is the only supported way to
create/refresh a user from a validated Telegram identity. It is
`security definer`, and `EXECUTE` is revoked from `public`/`anon`/
`authenticated` and granted only to `service_role` — a client can never
call it directly, validated Telegram identity or not. It never resets
`status`, roles, subscriptions, or referral attribution on a returning
login (Section 7), and is safe under two concurrent calls for the same
`telegram_user_id` (an `on conflict` recovery path, not a race).

## Service role usage

`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS entirely (see
`packages/config`'s `SERVER_ONLY_ENV_KEYS`) and must only ever be read on
the server (edge functions, the bot, a future backend service) — never
bundled into `apps/miniapp`.
