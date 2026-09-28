# Telegram Authentication (Section 02)

## Purpose

Section 01 built real `initData` HMAC validation (`@sport-os/telegram`'s
`validateInitData()`) but never turned a validated payload into anything
the rest of the app could use as "the current user" — `AuthBoundary` in
`apps/mini-app` resolved to `ready` immediately with no real check (see
`OPEN_QUESTIONS.md` #4, now resolved below). Section 02 closes that gap:
a verified `AuthenticatedTelegramIdentity`, a session boundary, and a real
frontend authentication flow. It does **not** add persistence, a user
table, or licensing — those stay Section 03+ concerns (see "What this
section deliberately does not do").

## Identity model

`AuthenticatedTelegramIdentity` (`packages/telegram/src/types.ts`) is the
only shape identity may take anywhere in this codebase:

```ts
interface AuthenticatedTelegramIdentity {
  telegramUserId: number;
  firstName: string;
  lastName: string | undefined;
  username: string | undefined;
  languageCode: string | undefined;
  isPremium: boolean | undefined;
  authDate: string;   // ISO 8601 — when Telegram signed the initData
  verifiedAt: string; // ISO 8601 — when this server verified it
  authMode: "telegram" | "dev";
}
```

`authMode` exists so nothing downstream can mistake a dev-mode identity
for a real one — every consumer (UI badge, audit event, future
authorization checks) can and should branch on it.

## `initData` vs `initDataUnsafe` — the one rule that matters

Telegram's WebApp bridge (`window.Telegram.WebApp`) exposes two things:

- **`initData`** — an opaque, signed query string. Meaningless until a
  server recomputes its HMAC with the bot token and confirms a match.
- **`initDataUnsafe`** — Telegram's own client-side *parse* of the same
  string, handed to the page for convenience (e.g. to show a name before
  the network round-trip completes). It is exactly as trustworthy as any
  other value a browser process can be made to report, because a
  compromised or spoofed client can set it to anything.

**`initDataUnsafe` must never be used for identity, authorization, or
audit.** `apps/mini-app/src/telegram/telegram-webapp.d.ts` documents this
in the type itself; `TelegramWebAppClient` doesn't even expose it —
`getRawInitData()` is the only accessor, and it returns the raw string,
never a parsed object.

## Server-side validation (the trust boundary)

`validateInitData()` (`packages/telegram/src/init-data.ts`) is the only
place a Telegram identity may be trusted from — a rule that predates
Section 02 (Security Principle 3) and Section 02 only strengthens:

1. Recompute `HMAC_SHA256(key=HMAC_SHA256(key="WebAppData", data=botToken), data=data_check_string)`
   over every field except `hash`, sorted by key, joined with `\n`.
2. Compare against the client-supplied `hash` with a **timing-safe**
   comparison (`node:crypto`'s `timingSafeEqual` in `packages/telegram`;
   a constant-time byte-XOR loop in the Deno edge function, since Web
   Crypto has no built-in equivalent) — an ordinary `===` would leak how
   many leading bytes matched.
3. Reject if `auth_date` is missing, non-numeric, zero, or negative
   (`TELEGRAM_INIT_DATA_MALFORMED`) — a bug present before Section 02 let
   a malformed `auth_date` become `NaN`, and `NaN > x` / `NaN < x` are
   both `false` in JS, so the freshness check below would silently pass.
   Fixed as part of this section (`init-data.ts`'s explicit
   `Number.isFinite` guard).
4. Reject if `auth_date` falls outside
   `[-clockSkewSeconds, +maxAgeSeconds]` around "now"
   (`TELEGRAM_INIT_DATA_EXPIRED`) — replay protection, plus tolerance for
   a client clock running slightly fast. Both bounds are configurable
   (`TELEGRAM_INIT_DATA_MAX_AGE_SECONDS`, `TELEGRAM_INIT_DATA_CLOCK_SKEW_SECONDS`;
   defaults 86400s / 60s, matching the library's own defaults so an unset
   env var behaves identically to calling `validateInitData()` with no
   options).
5. Only once all of the above pass does `user` get parsed out of the
   payload and become the identity's source of truth.

Every failure carries a specific `TelegramAuthErrorCode`
(`INIT_DATA_MISSING` / `INIT_DATA_INVALID` / `INIT_DATA_EXPIRED` /
`INIT_DATA_MALFORMED` / `AUTH_NOT_CONFIGURED` / `USER_MISSING`) — enough
for the client to render a sensible message, never enough to leak *why* a
signature check failed.

`DefaultTelegramAuthenticationService` (`authentication-service.ts`)
wraps this into the actual entry point: checks the bot token is
configured, checks `initData` isn't empty, calls `validateInitData()`,
checks a user was present, and returns `Result<AuthenticatedTelegramIdentity, AppError>`.
It is deliberately transport-agnostic (no HTTP concepts) so it's testable
standalone (`authentication-service.test.ts`) independent of the Supabase
Edge Function that calls it.

## The Deno reimplementation

`supabase/functions/telegram-auth/index.ts` cannot `import` from
`@sport-os/telegram` — Deno can't resolve an npm workspace package
without a bundling step Section 01 chose not to add (see
`docs/architecture/ARCHITECTURE.md`'s package map and the identical
precedent in `supabase/functions/health`). Its validation, session
issuance, and dev-auth logic are therefore hand-reimplemented using Web
Crypto instead of `node:crypto`. **Keep the two in sync** if either
changes — the Node version is canonical and has the test suite; the Deno
version mirrors it and does not have its own automated tests (no `deno`
runtime is available in this build environment to run one — the same gap
Section 01 left for `functions/health`).

## Session architecture

Section 01 deliberately deferred all persistence to Section 03 — there is
no database, no user table, nothing to back a server-side session store.
Section 02 needed *some* way to hand the client a credential after
verification without inventing persistence this section shouldn't own, so
`packages/telegram/src/session.ts` issues a **stateless, HMAC-signed
session token**:

```
token = base64url(JSON.stringify(session)) + "." + base64url(HMAC_SHA256(secret, payload))
```

where `session` is only `{ sessionId, telegramUserId, issuedAt, expiresAt,
authenticatedAt }` — never raw `initData`, never the bot token. Verifying
a token means recomputing that signature (timing-safe comparison again)
and checking `expiresAt`. No database round-trip, no shared state between
Edge Function isolates, nothing to invalidate server-side before
expiry — that last point is a real limitation, not an oversight: this
token **cannot be revoked** before it naturally expires
(`SESSION_TOKEN_TTL_SECONDS`, default 24h). That's the trade-off judged
acceptable for "the cleanest secure boundary available without inventing
persistent storage this section shouldn't own" (see the deliberate
`SESSION_SIGNING_SECRET` addition below). **Section 03, if it needs actual
revocation (ban a user mid-session, force logout everywhere), must
replace this with a real, persistent, revocable session store** — this
answers `OPEN_QUESTIONS.md`'s former #4 for now, but doesn't close the
door on changing it.

The token is held **in memory only** on the client (React state, via
`AuthContext`) — never written to `localStorage`/`sessionStorage`. It is
lost on a hard refresh by design; the Mini App re-authenticates against
`window.Telegram.WebApp.initData` on every load anyway, since Telegram
re-issues a fresh `initData` each time the Mini App is opened.

## A config addition beyond the section spec: `SESSION_SIGNING_SECRET`

The section's brief didn't name a specific env var for signing session
tokens. Rather than either (a) inventing a persistent session store to
avoid the question, or (b) silently picking an insecure default (e.g.
reusing `TELEGRAM_BOT_TOKEN` as the signing key), a new server-only secret
was added: `SESSION_SIGNING_SECRET`, required in production via the same
`superRefine` fail-safe pattern `packages/config` already uses for
`TELEGRAM_BOT_TOKEN`/`TELEGRAM_WEBHOOK_SECRET`. Flagged here per Section
01's "document architectural decisions transparently" precedent, not
silently decided.

## Dev-mode authentication

A gated bypass exists for local development without a live Telegram
client: `isDevAuthModeUsable(appEnv, devAuthMode)`
(`packages/telegram/src/dev-auth.ts`) returns `true` only when
`appEnv !== "production"` **and** `DEV_AUTH_MODE === "enabled"` — it
re-derives "not production" itself rather than trusting a caller's own
check, so no single misconfigured call site can enable it in production.
`packages/config`'s schema goes one step further: it refuses to even
*load* a config where `APP_ENV=production` and `DEV_AUTH_MODE=enabled`
are both set, regardless of whether any code path would have checked
`isDevAuthModeUsable()` correctly. Belt and suspenders.

When usable, `buildDevAuthenticatedIdentity()` returns a **fixed**
synthetic identity (`telegramUserId: 999999999`,
`username: "dev_user_do_not_use_in_production"`, `authMode: "dev"`) — it
takes no parameters and cannot be made to impersonate a real user. The
client can only reach it via an explicit `{ mode: "dev" }` request to
`/telegram-auth`, distinct from the normal `{ initData }` request; there
is no path from "a Telegram user id the client supplies" to an
authenticated identity anywhere in this system.

The client only *offers* the dev-login button when
`clientConfig.devAuthModeEnabled` is true, which requires the separate
`VITE_DEV_AUTH_MODE` var — see `docs/environment-variables.md` for why
this duplicates `DEV_AUTH_MODE`: Vite only exposes `VITE_`-prefixed vars
to the browser bundle, so a non-prefixed var can't reach client code at
all. This client flag is UI-only sugar — it grants no capability, since
the server independently re-verifies `DEV_AUTH_MODE` on every request.

## Frontend state machine

`apps/mini-app/src/auth/authReducer.ts` is a pure, dependency-free
reducer (no React import) with six explicit states:

| State | Meaning |
|---|---|
| `initializing` | Boundary just mounted; nothing decided yet. |
| `telegram_unavailable` | `window.Telegram.WebApp.initData` is empty — not opened inside Telegram. Offers the dev-login button if `devAuthModeEnabled`. |
| `authenticating` | A request to `/telegram-auth` is in flight (real or dev). |
| `authenticated` | Server-verified real Telegram identity + session token. |
| `dev_authenticated` | Server-verified dev identity — kept distinct from `authenticated` so a stray equality check can never treat a dev session as a production one; the UI also renders a visible "DEV MODE" tag whenever `authMode === "dev"`. |
| `auth_failed` | Validation failed server-side; carries the safe `code`/`message` pair, with a retry action wired to re-run the same flow. |

It's tested standalone in `authReducer.test.ts` (pure state transitions,
no rendering) and wired up in `apps/mini-app/src/shared/AuthBoundary.tsx`,
which composes `TelegramProvider` (the typed `window.Telegram.WebApp`
bridge — hand-rolled types in `telegram-webapp.d.ts`, not `window as any`,
and not an added SDK dependency) with the reducer via `useReducer`. No
route renders until the boundary reaches `authenticated` or
`dev_authenticated`; every other state renders a loading/error/prompt
screen instead.

## What this section deliberately does not do

- No user table, no persistence of any identity — `AuthenticatedTelegramIdentity`
  is a value, not a stored record. Section 03's job.
- No connection to `LicenseService`/`Entitlement` — authentication answers
  "who is this," not "what are they allowed to do." `GlobalExecutionGate`
  remains the only place authorization decisions are made, and it still
  has no real checks wired in (Section 01's `identity`/`license` gate
  checks are still test doubles).
- No revocable session store (see "Session architecture" above).
- No rate limiting beyond a single-isolate, best-effort, in-memory fixed
  window (`packages/shared/src/rate-limit.ts` on the Node side; a mirrored
  version in the Deno function) — explicitly documented as insufficient
  for a real distributed deployment. A production deployment needs a
  shared store (e.g. Redis, or a Supabase-backed counter) for this to be
  a real control rather than defense-in-depth.

## See also

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — Security Principles 1–3 now
  point here for the concrete mechanism.
- [`MODULE_BOUNDARIES.md`](./MODULE_BOUNDARIES.md) — where
  `TelegramAuthenticationService` sits among the 14 named boundaries.
- [`OPEN_QUESTIONS.md`](./OPEN_QUESTIONS.md) — former question #4,
  resolved here for now; new questions this section raised.
