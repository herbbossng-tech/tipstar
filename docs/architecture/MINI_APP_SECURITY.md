# Mini App Security (Section 09)

## The central rule

> **UI gating is NOT authorization.** Every protected backend request
> independently enforces license + entitlement + role, regardless of
> what the Mini App displays or hides.

Nothing in `apps/mini-app` can grant itself access to anything. There is
no local permission store, no client-side override, and no code path
from a rendered screen to a database write.

## Authentication (unchanged from Section 02/03)

`AuthBoundary`/`TelegramProvider`/`authReducer` are untouched by Section
09. The Mini App represents exactly five states —
`AUTHENTICATING`/`AUTHENTICATED`/`UNAUTHENTICATED` (rendered as
`telegram_unavailable`)/`SESSION_EXPIRED` (a `SESSION_EXPIRED`/
`SESSION_REVOKED` `ApiError` code, mapped by `QueryErrorState`'s
`describeErrorCode`)/`AUTH_ERROR` — never an implicit "authenticated"
fallback. Raw Telegram `initData`, the session signing secret, and any
other server configuration are never exposed to this layer — only the
opaque `initData` string (verified server-side) and the signed session
token (`AuthSessionHandle.token`), which itself carries no secret
material an attacker could derive anything from.

## Every new endpoint independently re-checks authorization

All five new Section 09 edge functions (`football-fixtures`,
`football-fixture-detail`, `tickets`, `ticket-detail`,
`performance-summary`) follow the identical sequence, via
`supabase/functions/_shared/auth.ts`:

1. `resolveAuthenticatedUser()` — verifies the bearer token's HMAC
   signature + expiry, checks it against `auth_sessions` for revocation,
   resolves the caller's OWN user row, and rejects if `status !==
   'active'`.
2. `requireEntitlement()` — resolves the caller's usable license
   (`status` in `{trial, active}` AND within its `starts_at`/
   `expires_at` window) and checks the specific `license_entitlements`
   row for the endpoint's feature key is `enabled = true`. A missing
   entitlement row is treated identically to `enabled = false` — never
   permissive by omission.

Every endpoint uses a **service-role** Supabase client (bypasses RLS
entirely) — but that client is never used to satisfy an arbitrary
client-supplied query. Every query it runs is hand-written, parameterized
by IDs the caller's OWN prior query already returned (e.g.
`ticket-detail`'s `ticketId` query param is used verbatim in a
`.eq("id", ticketId)` lookup — there is no raw SQL/RPC surface, and no
endpoint accepts a table name, column name, or filter expression from
the client).

## Adversarial scenarios (Section 09 §48)

| # | Scenario | Why it's safe |
|---|---|---|
| 1 | User modifies frontend entitlement state | `hasEntitlement()` (`auth/entitlements.ts`) only ever reads the real `/me` response — there is no separate store to tamper with, and even if a user forced a card to render, the underlying `authedGet` call to `tickets`/`football-fixtures`/etc. independently re-checks entitlement server-side and returns `403 FEATURE_NOT_ENTITLED`. |
| 2 | User changes displayed risk state | The Mini App renders `risk_evaluations` rows verbatim (`describeRiskApproval(boolean)`) — there is no code path anywhere in this app that computes or stores a risk decision; Section 07's Risk Engine remains the sole authority, entirely server-side. |
| 3 | User changes ticket status in the browser | No write endpoint for ticket status exists. Every ticket field the Mini App shows is read-only, sourced from `ticket-detail`. |
| 4 | User alters a displayed probability in DevTools | There is no execution trigger wired to any locally-held probability value — no write action reads client state to decide anything (see "What was not built" below). |
| 5 | Direct call to a protected endpoint without entitlement | `requireEntitlement()` runs before any data query in every endpoint — verified by the fact each endpoint's very first database call after authentication IS the entitlement check (see `supabase/functions/*/index.ts`). |
| 6 | Replayed "assisted confirmation" | No confirmation endpoint exists yet (see below) — nothing to replay. |

## What was not built, and why (§66/§68 stop conditions)

Ticket creation and assisted-execution confirmation were **not** wired
to a real backend write path:

- No repository persists `tickets`/`execution_requests`/
  `execution_results` to Supabase anywhere in this codebase yet — only
  the schema, RLS, and pure TypeScript engines exist (Sections 07/08
  built the math and the tables; no section has yet wired a service-
  role repository that an HTTP endpoint could call to actually create a
  ticket or submit an execution request).
- Building that repository now would be inventing new persistence/
  business logic outside Section 09's "UI-only" boundary — exactly the
  stop condition in §68: "a required backend endpoint does not exist and
  implementing it would require new business logic not defined in
  Sections 01–08."
- `ExecutionIntegration`'s only implementation
  (`NotImplementedExecutionIntegration`) throws rather than returning a
  typed "not available" response, so even a thin pass-through endpoint
  would need new error-shaping logic.

The Mini App therefore renders ticket/execution/settlement state as a
**pure read surface**. This is documented as an open architectural
question (`OPEN_QUESTIONS.md`), not silently worked around.

## Bundle secret scan

Verified (both manually against the built `dist/assets/*.js` and via
`apps/mini-app/src/security.test.ts`, which scans the actual source tree
on every `npm test` run):

- No `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SIGNING_SECRET`,
  `TELEGRAM_BOT_TOKEN`, or `service_role` string anywhere in source or
  the built bundle.
- No PEM/private-key material.
- The one "password" match in the built bundle is React's own internal
  list of HTML `<input type="...">` values — not a secret.
- `apps/mini-app/src/config.ts` is the ONLY place `import.meta.env` is
  read anywhere in the Mini App source (grepped) — and it delegates to
  `@sport-os/config/client`'s `loadClientConfig()`, which reads exactly
  `VITE_APP_NAME`/`VITE_API_BASE_URL`/`APP_ENV`/`VITE_DEV_AUTH_MODE` and
  nothing else (unchanged from Section 01/02 — Section 09 added no new
  client env var).

## Frontend environment variable classification

Unchanged from Section 01: Vite's own `VITE_`-prefix allowlist is the
only mechanism by which an env var reaches the browser bundle;
`packages/config`'s `SERVER_ONLY_ENV_KEYS` documents every var that must
never carry that prefix. Section 09 introduced no new environment
variables.

## No arbitrary fetch / no direct database access

`apps/mini-app/src/services/api.ts`'s `apiRequest`/`authedGet` are the
**only** sanctioned network call in this app — enforced by
`security.test.ts`'s structural scan (fails the build if a raw
`fetch()` appears anywhere else in `src/`). There is no Supabase client
in the Mini App bundle at all — every data need is served through a
purpose-built edge function, matching §46's "do not expose the entire
database... do not allow generic arbitrary SQL/RPC from the frontend."

## Error handling never leaks internals

Every edge function funnels failures through `errorResponse(code,
message, status)` — the `message` field is always a hand-written, safe
string (`"Could not load tickets."`, never a raw Postgres error). The
Mini App's `QueryErrorState`/`describeErrorCode` adds a further layer of
user-facing translation for well-known codes, and falls back to the
server's own (already-safe) message otherwise — no raw stack trace or
SQL detail is ever constructible from what the client receives.

## See also

- [`MINI_APP_ARCHITECTURE.md`](./MINI_APP_ARCHITECTURE.md)
- [`MINI_APP_DATA_CONTRACTS.md`](./MINI_APP_DATA_CONTRACTS.md)
- [`TELEGRAM_AUTHENTICATION.md`](./TELEGRAM_AUTHENTICATION.md)
- [`DATABASE_AND_RLS.md`](./DATABASE_AND_RLS.md)
