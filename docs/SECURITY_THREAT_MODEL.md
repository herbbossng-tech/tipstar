# Security Threat Model

Section 12 Part AW. This is the final, repository-wide threat model —
it does not re-derive each subsystem's own security design (that lives
in `docs/architecture/TELEGRAM_SECURITY.md`, `AUTHORIZATION.md`,
`AGENT_SECURITY.md`, `MINI_APP_SECURITY.md`, `OPERATIONS_SECURITY.md`,
`PUBLISHING_POLICY.md`); it enumerates who could attack this system,
what they could attempt, and what in this codebase actually stops them
— with an honest "not mitigated here" where that is the truth, rather
than a fabricated control.

Every mitigation cited below is implemented and covered by an existing
automated test (see the "Proof" column); the test files cited are from
`packages/*/src/**/*.test.ts`, `tests/database/*.sql`, and
`tests/e2e/*.test.ts` and were all re-run as part of Section 12 (see
`docs/PRODUCTION_READINESS.md`).

## 1. An unauthenticated internet client

**Attempts:** call an Edge Function directly without a valid session
token; replay an old `initData` payload; guess at internal UUIDs.

**Mitigations:** every Edge Function other than `health` requires a
valid `Authorization` bearer session token, itself only ever issued
after real Telegram `initData` HMAC verification
(`verifyInitData()`/`issueAuthSession()`); `initData` carries a
freshness window (`TELEGRAM_INIT_DATA_MAX_AGE_SECONDS`) and a bounded
clock-skew tolerance, so a captured payload cannot be replayed
indefinitely; RLS denies any direct PostgREST access regardless of
token validity, since all real backend operations go through Edge
Functions using the service-role key, never the anon key for writes.

**Proof:** `packages/telegram/src/init-data.test.ts`,
`packages/telegram/src/session.test.ts`,
`supabase/functions/telegram-auth/*.test.ts`,
`tests/database/20_rls_cases.sql`.

## 2. An authenticated user attempting privilege escalation

**Attempts:** supply `role: "admin"` or another user's `userId` in a
request body; call an admin-only Edge Function with a USER-role
session; forge a Telegram "from" id in a bot command's text.

**Mitigations:** every authorization check re-resolves the actor's
role from the database by their own verified identity
(`requireAdmin(toAuthorizationContext(user))`, never from
attacker-supplied JSON); `AuthorizationMatrix`
(`packages/platform/src/operations/authorization-matrix.ts`) is the
single source of truth every admin edge function and bot command
calls; bot commands resolve the actor from `ctx.from` — grammy's own
parse of Telegram's verified update payload — never from command
argument text (`/admin 123456789`-style forged-identity attempts
cannot become the authenticated actor; re-verified in Section 12 Part
AR, see `apps/bot/src/commands/types.ts`'s own doc comment).

**Proof:** `packages/platform/src/operations/authorization-matrix.test.ts`,
`packages/platform/src/operations/license-admin.test.ts`,
`apps/bot/src/commands/handlers.test.ts`.

## 3. A licensed user attempting to exceed their entitlements

**Attempts:** call a FOOTBALL_TICKETS-gated action with no active
license; use an expired/suspended/revoked license; replay a stale
entitlement cache.

**Mitigations:** `DatabaseLicenseService.getLicenseForUser()` performs
a real, uncached database read on every check; `GlobalExecutionGate`'s
`createLicenseGateCheck`/`createEntitlementGateCheck` deny before any
agent executes; license status transitions (ACTIVE/EXPIRED/
SUSPENDED/REVOKED) are enforced both in application logic and at the
RLS layer.

**Proof:** `tests/e2e/section12-failure-injection.test.ts` ("license
status denies the real execution gate" — EXPIRED/SUSPENDED/REVOKED, all
three proven to deny before the agent ever runs),
`packages/platform/src/license.test.ts`.

## 4. A malicious or compromised Telegram channel admin

**Attempts:** get the bot to publish arbitrary/unverified content to a
channel it controls; exceed per-destination publication rate limits;
use one destination's trust to affect another's.

**Mitigations:** `PublishingPolicyEngine` enforces per-destination
publish flags and daily caps; `TelegramDestinationManager` requires the
bot to independently verify its own admin status in a chat before any
destination is marked usable; one destination's publish failure is
structurally isolated from every other destination's own attempt
(`TelegramChannelManagementAgent.execute()`'s per-destination loop);
every outbound message is HTML-escaped before interpolation.

**Proof:** `packages/agents/src/telegram-channel-agent.test.ts`,
`docs/architecture/PUBLISHING_POLICY.md`.

## 5. A rogue or buggy internal agent (code-level, not network attacker)

**Attempts:** an agent executes outside its declared side-effect level;
an agent bypasses `GlobalExecutionGate`; two concurrent dispatches with
the same idempotency key both run.

**Mitigations:** `AgentOrchestrator.dispatch()` is the ONLY path that
invokes an agent's `execute()` with authorization already enforced;
`isWithinDeclaredSideEffectLevel()` denies any dispatch that exceeds an
agent's own declared ceiling; idempotency claims are atomic
(`IdempotencyStore.claim()`), proven to prevent a genuine duplicate
execution.

**Proof:** `tests/agents/execution-pipeline.test.ts`,
`tests/e2e/section12-failure-injection.test.ts` ("a duplicate
idempotency key never double-executes" — proven with a real dispatch,
not a mocked claim), `packages/agent-core/src/orchestrator.test.ts`.

**Known, documented gap (not a vulnerability — an architecture
limitation discovered in Section 12):** `AgentOrchestrator.dispatch()`
only ever passes `{ invocationId }` as `ExecutionAuthorizer.authorize()`
metadata; nothing in the current codebase threads a real
`TicketRiskEvaluation` into that call. `createRiskGateCheck()` (from
`buildStandardGateChecks()`) therefore always denies with
`RISK_EVALUATION_MISSING` through a real dispatch today — risk IS
evaluated for real as its own pipeline step (`evaluateTicketRisk()`),
just not yet re-threaded into the execution gate's own defense-in-depth
re-check. See `tests/e2e/section12-chains.test.ts` CHAIN 1's own doc
comment. Tracked as a P2 production-functionality gap, not fixed here
(see `docs/PRODUCTION_READINESS.md`).

## 6. A party attempting financial manipulation of settlement/ledger data

**Attempts:** rewrite a settled ticket's outcome after payout; mix
PAPER and LIVE figures into one performance number; double-count a
ticket's P&L across two ledger entries.

**Mitigations:** settlement records are append-only with explicit
revisions, never in-place mutation; `LedgerMode` (PAPER/LIVE) is a hard
partition carried through every performance/report computation, never
merged; the financial accounting layer separates "calculated"
(model-expected) from "actual" (really settled) figures at the type
level, so one can never silently substitute for the other.

**Proof:** `packages/agents/src/section08-adversarial.test.ts` (28
tests, re-run clean in Section 12 — see
`docs/PRODUCTION_READINESS.md`), `tests/database/120_section08_rls_cases.sql`.

## 7. A Telegram Bot API outage or malicious response

**Attempts:** Telegram API returns errors/malformed data; a webhook
delivers a forged update without the correct secret token.

**Mitigations:** `TELEGRAM_WEBHOOK_SECRET` is checked against
`X-Telegram-Bot-Api-Secret-Token` on every webhook request, rejecting
anything that doesn't match (`apps/bot/src/server.ts`); every
`TelegramService` call returns a typed `Result`, never throws, so a
Bot API failure degrades to a classified job failure, never a crash or
a fabricated success signal for an individual send.

**Documented gap:** a TOTAL outage (every destination fails to send)
currently still reports the publication job as `ok: true` at the job
level, because `TelegramReportPublicationJobHandler` only inspects
`orchestrator.dispatch()`'s own success, not the per-destination
`skipped` list inside it — see
`tests/e2e/section12-failure-injection.test.ts`'s own documented
finding. This is an operational monitoring gap (the job is not
retried), not a money/report-integrity issue — no report content or
financial record is affected.

**Proof:** `tests/e2e/section12-failure-injection.test.ts`.

## 8. A dependency-chain / supply-chain attacker

**Attempts:** a compromised npm package in the dependency tree;
a known CVE in a transitive dependency.

**Mitigations:** `npm audit` run against production dependencies only
(`--omit=dev`) shows exactly 2 moderate findings, both in
`react-router`/`react-router-dom` (CVE-2025-68470-adjacent open-redirect
and an SSR-only deserialization issue) — this codebase has zero
`useNavigate()` calls, only UUID-interpolated `<Link to>` usage, and no
SSR, so neither is practically exploitable here; the high/critical
findings (`vite`/`vitest`/`esbuild` chain) are entirely within
`devDependencies`, never shipped to a deployed artifact (confirmed by
inspecting `package.json`'s `devDependencies` block directly).

**Proof:** `npm audit --omit=dev` output (recorded in
`docs/PRODUCTION_READINESS.md`'s dependency-audit section).

## 9. A party attempting to discover training-time data leakage

**Attempts:** exploit any point where a model/feature pipeline could
see future information (post-match odds movement, final score) before
a prediction's stated `snapshotTime`.

**Mitigations:** `LeakageGuard`'s `asOf()` query contract is the only
sanctioned way Sections 04/05 read historical data; every temporal
correctness regression test (fixture status, match-result versioning)
asserts no future state leaks into an earlier snapshot.

**Proof:** `packages/football-engine/src/leakage-guard.test.ts` (17
tests), `packages/football-engine/src/section-05-leakage.test.ts` (3
tests) — all re-run clean in Section 12 Part AO with zero changes
needed (see `docs/PRODUCTION_READINESS.md`).

## 10. A party attempting to extract secrets from the client bundle

**Attempts:** inspect the built Mini App's JS bundle for
`SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, or
`SESSION_SIGNING_SECRET`.

**Mitigations:** `@sport-os/config/client` is a separate module with no
import path to the server schema or any secret value;
`SERVER_ONLY_ENV_KEYS` is the machine-checkable source of truth for
what must never reach a browser bundle; Section 02's and Section 09's
final reports both record a real build-then-grep verification finding
zero secret strings in `dist/assets/*.js`.

**Proof:** `packages/config/src/client.test.ts`, the build-artifact
secret scan re-run in `docs/PRODUCTION_READINESS.md`.

## 11. An operator/insider with service-role database access

**Attempts:** bypass application-layer authorization entirely by
querying Postgres directly with the service-role key.

**Mitigations:** this is explicitly NOT mitigated by RLS (the
service-role key bypasses RLS by design, as it must for the
server-side services that legitimately need cross-row access) — the
control here is operational, not technical: `SUPABASE_SERVICE_ROLE_KEY`
custody, rotation, and access logging are an infrastructure
responsibility outside this repository's code, documented explicitly as
such in `docs/OPERATIONS_RUNBOOK.md`'s secret-rotation section rather
than claimed as solved by application code. Every *application* write
path still goes through the same authorization/audit logic regardless
of which credential executes the underlying SQL, so a mis-scoped
insider action is still auditable after the fact via `audit_events`,
even though it cannot be technically prevented from the application
layer.

---

**What this threat model does not cover (explicitly out of scope, per
the Section 12 non-goals):** real bookmaker/SportyBet API integration
security (no such integration exists —
`NotImplementedExecutionIntegration` is the only implementation),
CAPTCHA/anti-bot evasion, and any live-money execution path (none
exists; see `docs/PRODUCTION_READINESS.md`'s execution-integration
row).
