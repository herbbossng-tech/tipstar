# Telegram Security Foundation

Telegram authentication is the trust boundary for the entire platform. The
client (Mini App) is never trusted to assert its own identity.

## initData validation

The Mini App retrieves the raw, Telegram-signed `initData` string via the
official `@telegram-apps/sdk` (`retrieveRawInitData()`,
`apps/miniapp/src/telegram/TelegramProvider.tsx`) and sends it to the
backend as-is. The client never parses it to derive a "trusted" user — it
is just an opaque signed blob until the server says otherwise.
`initDataUnsafe`-equivalent data (`useTelegram().unsafeUser`, via
`parseUnsafeUser.ts`) exists only for optimistic UI/display (e.g. a
greeting while the real request is in flight) and is never treated as
authenticated identity, and never sent anywhere as if it were.

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

## Session establishment (Section 02)

`POST /telegram-init-auth` (`supabase/functions/telegram-init-auth`) is the
one place the full authentication flow happens:

```
Mini App                    telegram-init-auth (Edge Function)         Postgres
   │  raw initData                  │                                     │
   ├────────────────────────────────▶                                    │
   │                                 │ validateInitData() (HMAC/auth_date)│
   │                                 │ RPC upsert_telegram_user(...)      │
   │                                 ├─────────────────────────────────────▶
   │                                 │◀──── resolved users row ────────────┤
   │                                 │ issueSessionToken() [HS256, signed  │
   │                                 │  with SUPABASE_JWT_SECRET]          │
   │◀──── { user, session } ─────────┤                                     │
```

- **`resolveOrCreateSession`** (`packages/telegram/src/session.ts`) defines
  the idempotency contract: given a validated Telegram user, resolve an
  existing internal `User`/`TelegramIdentity` pair or create exactly one
  new pair, keyed by `telegram_user_id`. Its Supabase-backed implementation
  is the `upsert_telegram_user` Postgres function
  (`supabase/migrations/20260921000000_telegram_session_upsert.sql`) —
  `security definer`, restricted to `service_role`, and safe under
  concurrent calls for the same Telegram user (an `on conflict` recovery
  path avoids the duplicate-user race). It refreshes only
  Telegram-supplied display fields (username, name, language, premium
  flag, `last_active_at`) on a returning login — `status`, roles,
  subscriptions, and referral attribution are never reset by
  re-authenticating (Section 7).
  `packages/telegram/src/in-memory-user-repository.ts` is a
  development/test double proving the idempotency contract in
  `packages/telegram/src/session.test.ts` without a database.
- **Session tokens** (`@tipstar/session`, mirrored for Deno in both
  `telegram-init-auth` and `telegram-me`) are compact HS256 JWTs carrying
  `{ sub, role: "authenticated", tipstar_user_id, telegram_user_id, iat,
  exp }`, signed with `SUPABASE_JWT_SECRET` — the **same** secret
  PostgREST uses to validate bearer tokens. This is what lets
  `tipstar_auth_user_id()` (`supabase/migrations/20260919000000_init_schema.sql`)
  read `tipstar_user_id` out of `request.jwt.claims` for RLS, exactly as
  ADR 0002 anticipated, without adopting Supabase's email/OAuth auth.
  `packages/session/src/jwt.ts` is unit-tested for a valid round-trip, a
  wrong-secret signature, a tampered payload, and an expired token
  (`packages/session/src/jwt.test.ts`).
- **`GET /telegram-me`** (`supabase/functions/telegram-me`) verifies the
  bearer token itself, then queries Postgres **as that token** (anon key +
  `Authorization: Bearer <token>`), not the service role — so the response
  is exactly what RLS allows, proving the RLS policies from
  `docs/architecture/database.md` actually gate a real authenticated
  request rather than being aspirational.
- Session tokens are kept client-side in `sessionStorage` (cleared when the
  Mini App's WebView tab closes), not `localStorage` — see
  `apps/miniapp/src/auth/AuthProvider.tsx`.

## Development mode

`TIPSTAR_DEV_AUTH_BYPASS` lets local development authenticate without a
real Telegram launch. It is read from `packages/config`'s
`loadServerConfig()`/`loadClientConfig()`, which **always** AND it with
`APP_ENV !== "production"` — the flag has no effect at all when
`APP_ENV=production`, regardless of its value, so it cannot ship enabled
in production by accident. `telegram-init-auth` re-checks this itself
(`isDevBypassEnabled()`) before honoring a `devTelegramUser` payload — the
client-visible `devAuthBypassEnabled` flag (`ClientConfig`) only controls
whether the Mini App *shows* a "Continue as dev user" affordance
(`apps/miniapp/src/auth/ProtectedRoute.tsx`); it is not itself trusted for
anything security-relevant. Every response emitted from this path carries
`authMode: "dev_bypass"`, so it is never confused with a validated
Telegram login in logs or client state.

## Error states

`telegram-init-auth` and `telegram-me` return a machine-readable
`error`/`reason` code (never a stack trace or raw database error) for
every failure mode: missing/malformed/invalid-signature/expired initData,
a missing Telegram user, user-provisioning failure, an invalid/expired
session, and server misconfiguration. `apps/miniapp/src/api/client.ts`
(`describeErrorCode`) maps every one of these to safe, user-facing copy —
see `apps/miniapp/src/auth/ProtectedRoute.tsx` for how each `AuthStatus`
value (`initializing`, `authenticating`, `authenticated`, `unavailable`,
`unauthenticated`, `error`) renders a Loading/Empty/Error state instead of
a blank screen or a silent failure.

## What is explicitly NOT done here

- The client never sends a bare `telegram_user_id` that the server trusts.
- No rate limiting is implemented yet (see Section 25 in the product
  brief; the interfaces here are where a future rate limiter would hook
  in, at `validateInitData`, `upsert_telegram_user`, and the webhook
  handlers).
- No bookmaker/payment automation of any kind (Section 42, permanent).
