# API Surface

Tipstar's backend is a set of Supabase Edge Functions (Deno) plus direct
PostgREST access governed by Row Level Security — there is no separate
Node API server (see `docs/architecture/overview.md`).

| Endpoint | Runtime | Purpose |
|---|---|---|
| `POST /telegram-init-auth` | Supabase Edge Function, `supabase/functions/telegram-init-auth` | Validates Mini App `initData` (or, in development only, a `devTelegramUser` bypass), idempotently resolves/creates the Tipstar user, and issues a session token. Returns `{ user, session, authMode }` or `401`/`503`/`500` with a safe error code. |
| `GET /telegram-me` | Supabase Edge Function, `supabase/functions/telegram-me` | Verifies the bearer session token, then reads the caller's own profile **through RLS** (not the service role). Returns `{ user }` or `401`. |
| `POST /telegram-webhook` | Supabase Edge Function, `supabase/functions/telegram-webhook` | Verifies the Telegram webhook secret header and acknowledges bot updates. |
| `POST /telegram/webhook` | `apps/bot` (Node, grammy) | Local/self-hosted alternative to the edge function above, for development via long polling or a self-managed webhook. |

Every Mini App call to these goes through `apps/miniapp/src/api/client.ts`
(`apiRequest`) — no component constructs a raw `fetch()` — which attaches
`Authorization: Bearer <session token>` when one is available, normalizes
errors into `ApiError { code, message, status }`, and applies a request
timeout. See `apps/miniapp/src/api/auth.ts` for the two calls this section
adds: `authenticateWithTelegram` / `authenticateWithDevBypass` and
`fetchCurrentUser`.

## Request/response shapes

```
POST /telegram-init-auth
  { "initData": "<raw Telegram initData>" }
  -> 200 { "user": UserProfileDTO, "session": { accessToken, tokenType, expiresAt }, "authMode": "telegram" }
  -> 401 { "error": "unauthorized", "reason": "signature_invalid" | "expired" | ... }
  -> 400 { "error": "missing_init_data" | "invalid_json" }
  -> 503 { "error": "user_provisioning_failed" }

GET /telegram-me
  Authorization: Bearer <session token>
  -> 200 { "user": UserProfileDTO }
  -> 401 { "error": "unauthorized", "reason": "missing_session" | "session_invalid_or_expired" | "session_not_found" }
```

`UserProfileDTO` (`packages/session/src/profile.ts`, mirrored client-side
in `apps/miniapp/src/api/types.ts`) is the only shape a client ever
receives — it never carries internal-only fields, service-role data, or
security metadata (Section 8).

A general-purpose REST/RPC API for product data (picks feed, performance
stats) remains out of scope here (see product brief Section 32, scope
control) — it will be built in a later section on top of `packages/picks`,
`packages/performance`, and `packages/entitlements`, most likely as
additional Supabase Edge Functions, following the same pattern this
section establishes.
