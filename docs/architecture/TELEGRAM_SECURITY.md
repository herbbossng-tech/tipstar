# Telegram Bot Security Model (Section 10)

## Purpose

The bot (`apps/bot`) has a genuinely different trust chain from the
Mini App (`TELEGRAM_AUTHENTICATION.md`), and a real, small attack
surface (no callback buttons, server-only token, service-role-mediated
writes). This document states both precisely.

## Trust model: the bot's own update delivery IS the authentication boundary

The Mini App authenticates by cryptographically re-verifying Telegram's
signed `initData` HMAC, then issuing a session token
(`TELEGRAM_AUTHENTICATION.md`). The bot has no equivalent initData to
verify — instead, `grammy`'s `ctx.from` is sourced from Telegram's own
update delivery:

- **Webhook mode** — every request is rejected before reaching the bot
  unless its `X-Telegram-Bot-Api-Secret-Token` header matches the
  secret registered via `setWebhook` (`server.ts`'s
  `verifyWebhookSecret()`, unchanged from Section 01).
- **Long-polling mode** (local development) — the bot holds a direct,
  authenticated connection to the Telegram Bot API using the bot token;
  nothing else can inject an update into it.

Either way, by the time a command handler runs, `ctx.from.id` is a
value Telegram itself asserts, not something a client could spoof. This
is why `commands/handlers.ts` trusts it directly — **never** a value
read from a command argument, a callback payload, or any other
client-controlled field. `/status`/`/account`/`/destinations` resolve
and act on `ctx.from` only; there is no code path, anywhere, that lets
one Telegram user ask for or mutate another's data by supplying an id.

## Identification reuses Section 02/03's own upsert path

`identify()` (`commands/handlers.ts`) calls
`upsertAuthenticatedTelegramUser()` — the exact function Section 02/03
built for Mini App initData — passing `authMode: "telegram"`. This is
not a new, parallel identity path; it is the same `UsersRepository`
contract, with the bot's own update-delivery channel standing in as the
authentication proof instead of a verified initData payload.

## No callback buttons — no callback-query attack surface

Every inline button this codebase ever sends is a plain URL button
(`InlineKeyboardUrlButton`), pointing only at the Mini App or an equally
fixed destination. There is no `answerCallbackQuery` handling anywhere,
no callback payload is ever trusted, and the entire "callback query is
untrusted input" concern the spec raises has no code to exploit — it is
structurally absent rather than merely defended against.

## Token and secret handling

- `TELEGRAM_BOT_TOKEN` is read only in `apps/bot`'s server process and
  inside `TelegramBotApiService`'s request URL — never logged (the
  service's own error paths record a category/description, never the
  request URL or headers), never returned from a bot reply, never read
  by `apps/mini-app` (not a `VITE_`-prefixed var, and it is on
  `SERVER_ONLY_ENV_KEYS`).
- `TELEGRAM_PUBLISH_RETRY_LIMIT`/`TELEGRAM_PUBLISH_TIMEOUT_MS`/
  `TELEGRAM_MINI_APP_URL` are genuinely not secrets (tuning values and a
  public URL) and are deliberately NOT added to `SERVER_ONLY_ENV_KEYS` —
  but nothing in `apps/mini-app` reads them either way, since
  `loadClientConfig()` only ever reads `VITE_`-prefixed vars.
- Bundle verification: `apps/mini-app`'s production build was rebuilt
  after Section 10 and is byte-for-byte unchanged in size from the
  Section 09 baseline (200.17 kB JS / 62.54 kB gzip) — confirming zero
  Section 10 code or config reached the browser bundle. A grep of the
  built bundle for `TELEGRAM_BOT_TOKEN`/`botToken`/`BOT_TOKEN` finds
  nothing.

## Error responses are safe and factual

Every bot reply that can fail (`/status` with no license,
`/destinations` denied, `/verifydestination` on an unknown id) returns
the SAME safe, factual message the underlying service's own
`AuthorizationError`/`ValidationError` carries — "This action requires
administrative authority," "Destination not found." Nothing in
`commands/handlers.ts` ever forwards a raw repository error, a SQL
message, or an internal id to a chat.

## Database: RLS, never a direct client write

`telegram_destinations`/`telegram_publications` have no
`authenticated`-role write policy at all (see
`20261001180300_telegram_rls_policies.sql`). Both tables are admin-only
`SELECT` for `authenticated`, full access for `service_role` only.
Every write — destination create/verify/update/disable, publication
create/transition — goes through a service-role-backed repository that
has already run its own application-level authorization check. An
ordinary `USER` cannot create a destination, cannot forge a publication
row, cannot inject a `telegram_message_id`, and cannot flip a
publication's status — confirmed by `tests/database/140_section10_rls_cases.sql`
(18 cases, run against real Postgres) and by the TypeScript-level tests
in `destination-manager.test.ts`.

## Adversarial / security test coverage

| # | Scenario | Where it's tested |
|---|---|---|
| A | Non-admin cannot create a destination | `destination-manager.test.ts` TEST A |
| B | Non-admin cannot verify/update/disable a destination | `destination-manager.test.ts` TEST F/H/I |
| C | A destination is never marked VERIFIED without a successful `getChat` | `destination-manager.test.ts` TEST E |
| D | A retried publish never sends a second Telegram message | `telegram-channel-agent-publishing.test.ts` TEST A |
| E | A multi-destination fanout failure never cross-contaminates other destinations | `telegram-channel-agent-publishing.test.ts` TEST B |
| F | An accumulator renders as ONE message, N numbered legs | `templates.test.ts` |
| G | A NULL payout/P&L renders as "Not available," never `0.00` | `templates.test.ts`, `telegram-channel-agent-publishing.test.ts` |
| H | Telegram-breaking characters (`&`/`<`/`>`/`"`) are always HTML-escaped | `templates.test.ts` |
| I | `/destinations` denies a non-admin with a safe message, never leaking destination data | `handlers.test.ts` |
| J | `/status` always resolves from the authenticated `ctx.from` only — two different users get two independent results | `handlers.test.ts` (implicit — no id parameter exists to pass) |
| K | Unknown/suspended/unlicensed/unentitled users are denied at the correct, specific check (identity/license/entitlement) | `publishing-authorizer.test.ts` |
| L | Database-level: ordinary USER blocked from every destination/publication write, by RLS itself, not just application code | `tests/database/140_section10_rls_cases.sql` |

## See also

- [`TELEGRAM_AUTHENTICATION.md`](./TELEGRAM_AUTHENTICATION.md) — the
  Mini App's own, different trust chain.
- [`TELEGRAM_DESTINATIONS.md`](./TELEGRAM_DESTINATIONS.md) — OWNER/ADMIN
  authorization in full.
- [`AGENT_SECURITY.md`](./AGENT_SECURITY.md) — `AgentOrchestrator`'s own
  authorization/idempotency/audit guarantees, which
  `TelegramChannelManagementAgent` is dispatched through.
