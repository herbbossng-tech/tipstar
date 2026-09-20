# Telegram Security Foundation

Telegram authentication is the trust boundary for the entire platform. The
client (Mini App) is never trusted to assert its own identity.

## initData validation

The Mini App retrieves the raw, Telegram-signed `initData` string via the
official `@telegram-apps/sdk` (`retrieveRawInitData()`,
`apps/miniapp/src/telegram/bootstrap.ts`) and sends it to the backend
as-is. The client never parses it to derive a "trusted" user — it is just
an opaque signed blob until the server says otherwise.

Server-side validation lives in `packages/telegram/src/init-data.ts`
(`validateInitData`) and is mirrored, for the Deno runtime, in
`supabase/functions/telegram-init-auth/index.ts`. The algorithm:

1. Extract every field from `initData` except `hash`.
2. Sort the fields by key and join as `key=value` lines → `data_check_string`.
3. `secret_key = HMAC_SHA256(key="WebAppData", data=BOT_TOKEN)`
4. `expected_hash = HEX(HMAC_SHA256(key=secret_key, data=data_check_string))`
5. Reject unless `expected_hash` matches the payload's `hash` field
   (constant-time comparison via `node:crypto`'s `timingSafeEqual` /
   Web Crypto equivalent).
6. Reject if `auth_date` is older than `TELEGRAM_INITDATA_MAX_AGE_SECONDS`
   (replay protection) or more than 60 seconds in the future.

Only after this passes is `initData.user` — the Telegram user id, name,
username — considered trustworthy. See `packages/telegram/src/init-data.test.ts`
for tests covering a tampered field, a wrong bot token, and an expired
payload, using the real HMAC algorithm (no mocked crypto).

## Webhook verification

Telegram signs every webhook delivery with a secret token set via
`setWebhook`, echoed back as `X-Telegram-Bot-Api-Secret-Token`.
`packages/telegram/src/webhook.ts` (`verifyWebhookSecret`) and its Deno
mirror in `supabase/functions/telegram-webhook/index.ts` reject any request
whose header doesn't match `TELEGRAM_WEBHOOK_SECRET`, before the payload is
ever parsed or handed to bot logic.

## Session establishment (boundary for Section 02+)

`packages/telegram/src/session.ts` defines `UserIdentityRepository` and
`resolveOrCreateSession()`: given a *validated* Telegram user, resolve an
existing internal `User`/`TelegramIdentity` pair or create exactly one new
pair, keyed by `telegram_user_id` (idempotent — see
`buildIdempotencyKey("telegram_user", telegramUserId)`). The concrete
Supabase-backed repository, and issuing a session/JWT carrying the internal
`tipstar_user_id` claim that RLS policies key off of
(`tipstar_auth_user_id()` in the initial migration), is implemented in a
later section — this package only owns the Telegram protocol concerns.

## What is explicitly NOT done here

- The client never sends a bare `telegram_user_id` that the server trusts.
- No session/JWT issuance is implemented yet (interfaces only).
- No rate limiting is implemented yet (see Section 25 in the product brief;
  the interfaces here are where a future rate limiter would hook in, at
  `validateInitData` and the webhook handlers).
