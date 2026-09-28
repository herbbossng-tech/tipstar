# Module Boundaries

## The 14 backend/service boundaries

Where each lives, and its Section 01 implementation status. "Real" means
genuine, tested logic exists today (not a placeholder that fakes
production data); "NotImplemented" means the interface is fixed and a
concrete class throws `NotImplementedError` from every method; "contract
only" means an interface exists with no default implementation at all
(nothing to construct yet).

| # | Service | Package | File | Status |
|---|---|---|---|---|
| 1 | IdentityService | `@sport-os/platform` | `identity.ts` | **Real** (Section 03 — `DatabaseIdentityService` + `SupabaseUsersRepository`/`InMemoryUsersRepository`); `NotImplementedIdentityService` retained for any caller that hasn't migrated. Distinct from `TelegramAuthenticationService` below, which answers "who is this" for a single request/session, not "what account does this map to." |
| 2 | LicenseService | `@sport-os/platform` | `license.ts` | **Real** (Section 03 — `DatabaseLicenseService` + Supabase/InMemory repositories for licenses/entitlements/limits); `licenseAllows()`/`isLicenseUsable()` decision rules are real and now also honor `startsAt` |
| 3 | AgentService | `@sport-os/agent-core` | `agent-service.ts` | **Real** (`InMemoryAgentRegistry`) |
| 4 | FootballService | `@sport-os/football-engine` | `service.ts` | NotImplemented (depends on Section 05's models/decision logic; the data layer it will eventually read from is now real — see "Football Data Boundary" below) |
| 5 | AviatorService | `@sport-os/aviator-engine` | `service.ts` | NotImplemented (depends on the whole Aviator pipeline) |
| 6 | RiskService | `@sport-os/risk-engine` | `service.ts` | NotImplemented (sport-specific risk models). Note: `GlobalDailyRiskController` in the same package is **real** — it is a different, cross-sport concern. |
| 7 | MarketService | `@sport-os/market-engine` | `service.ts` | NotImplemented (needs a real odds provider) |
| 8 | TicketService | `@sport-os/settlement-engine` | `service.ts` | NotImplemented (needs the Decision Engine) |
| 9 | SettlementService | `@sport-os/settlement-engine` | `service.ts` | NotImplemented (needs real match results). Ticket rules (`rules.ts`) are **real**. |
| 10 | TelegramService | `@sport-os/telegram` | `service.ts` | **Real** (`TelegramBotApiService`, a thin Bot API client) |
| 11 | PublishingService | `@sport-os/telegram` | `service.ts` | NotImplemented (needs a persisted destination catalog). The Publishing Policy Engine (`publishing-policy.ts`) that decides *whether* a destination accepts content is **real**. |
| 12 | ReportingService | `@sport-os/platform` | `reporting.ts` | NotImplemented (needs real settled data) |
| 13 | AuditService | `@sport-os/platform` | `audit.ts` | **Real**: `InMemoryAuditService` (Section 01, still used in tests) and `SupabaseAuditService` (Section 03, real persistence to `audit_logs`, metadata redacted before write) |
| 14 | HealthService | `@sport-os/platform` | `health.ts` | **Real** (`buildHealthReport`); exposed via `supabase/functions/health` |
| — | TelegramAuthenticationService | `@sport-os/telegram` | `authentication-service.ts` | **Real** (Section 02, extended Section 03). Verifies raw `initData`, issues a stateless signed session token (`session.ts`), now persisted for revocation (`session-store.ts`, Section 03); exposed via `supabase/functions/telegram-auth`, which also upserts the caller into `users` and audits the event. Not one of the blueprint's original 14 — added the same way `packages/config` and `packages/platform` were (see `ARCHITECTURE.md`'s "Why two packages beyond the eight the blueprint named" and `OPEN_QUESTIONS.md` #5). |
| — | User admin / role management | `@sport-os/platform` | `user-admin.ts` | **Real** (Section 03). `suspendUser`/`reactivateUser`/`changeUserRole` — authorization-checked, audited. Not one of the blueprint's original 14 — see `AUTHORIZATION.md`. |
| — | Owner bootstrap | `@sport-os/platform` | `owner-bootstrap.ts` | **Real** (Section 03). One-time, secret-gated, auditable OWNER promotion; exposed via `supabase/functions/owner-bootstrap`. See `AUTHORIZATION.md`. |

## Agent Core

See [`../agents/AGENT_CORE.md`](../agents/AGENT_CORE.md) for the Agent
contract, lifecycle, and how every named agent in the product definition
maps to `AgentType`.

## Global Execution Gate

`@sport-os/platform`'s `GlobalExecutionGate` implements the fixed-order
pipeline (identity → license → entitlement → risk → integration
availability → execution authorization) as real orchestration: a list of
injected `GateCheck`s, evaluated in order, short-circuiting on the first
denial. No individual check's business logic is implemented in Section
01 — callers inject test doubles today; real checks (backed by
IdentityService, LicenseService, etc.) are wired in as those services
gain real implementations.

## Telegram Foundation

- `validateInitData()` — real, HMAC-SHA256 per Telegram's documented
  Mini App algorithm (ported with tests from prior work, still the only
  place Telegram identity may be trusted from). Section 02 added
  configurable freshness (`maxAgeSeconds`/`clockSkewSeconds`), per-failure
  `TelegramAuthErrorCode`s, and fixed a latent bug where a malformed
  `auth_date` produced `NaN` and silently passed the freshness check.
- `verifyWebhookSecret()` — real, constant-time comparison.
- `TelegramDestination` — typed, validated (`validateTelegramDestination`),
  never a hard-coded chat id anywhere in this codebase.
- `evaluatePublishingPolicy()` / `selectPublishableDestinations()` — real,
  deterministic: given a destination's own configured flags, decides
  whether it currently accepts a content type. Does not decide *what* to
  publish.
- `TelegramDestinationManager` (CRUD) — `NotImplemented`, needs
  persistence (Section 03).
- `DefaultTelegramAuthenticationService` / `issueAuthSession()` /
  `verifyAuthSession()` / `isDevAuthModeUsable()` — real (Section 02); see
  `docs/architecture/TELEGRAM_AUTHENTICATION.md` for the full design.
- `AuthSessionStore` / `InMemoryAuthSessionStore` /
  `verifyAuthSessionWithRevocation()` — real (Section 03), additive to
  the above (no Section 02 signature changed). Backing implementation
  (`SupabaseAuthSessionStore`) lives in `@sport-os/platform`.

## Licensing Foundation

`LicenseStatus` (`trial`/`active`/`suspended`/`expired`/`revoked`),
`Role` (`owner`/`admin`/`user`), and `Entitlement` (the 9 named in the
product definition) are fixed types, unchanged since Section 01.
`licenseAllows(license, entitlement, now)` / `isLicenseUsable(license,
now)` are real, tested pure functions. As of Section 03 this **is** wired
into a real request path: `DatabaseLicenseService` +
`SupabaseLicensesRepository`/`SupabaseLicenseEntitlementsRepository`/
`SupabaseLicenseLimitsRepository`, exposed to the Mini App via
`supabase/functions/me`. See `docs/architecture/LICENSING.md`.

## Roles, User Status, and Database Persistence (Section 03)

`UserRole`/`UserStatus` and the full `users`/`licenses`/
`license_entitlements`/`license_limits`/`auth_sessions`/`audit_logs`/
`platform_settings` schema, RLS policies, and the
`@sport-os/platform` service layer built on top of them (identity
upsert, admin operations, authorization guards, owner bootstrap) — see
`docs/architecture/DATABASE_AND_RLS.md` and
`docs/architecture/AUTHORIZATION.md` for the full design, and
`tests/database/` for the RLS test suite.

## Global Daily Risk Controller

`@sport-os/risk-engine`'s `GlobalDailyRiskController` is real: it tracks
cumulative P/L from `recordResult(amount)` calls, transitions to
`DAILY_TARGET_REACHED` or `DAILY_STOP_LOSS_REACHED` when a threshold is
crossed, and `isExecutionAllowed()` becomes `false` at that point until
`reset()`. It has no I/O and no model — it operates purely on numbers its
caller supplies, which is why it's safe to implement for real in Section
01 (see `docs/architecture/ARCHITECTURE.md`, Security Principle 8: it
must sit above every automation agent).

## Football Data Boundary (Section 04)

`@sport-os/football-engine`'s data ingestion/normalization/quality/
leakage-protection layer is real — canonical model (`canonical.ts`),
provider-agnostic adapter contract (`provider.ts`), normalization
(`normalize.ts`), ingestion orchestration (`ingestion.ts`),
`DataQualityEngine` (`quality-engine.ts`), quarantine + multi-provider
conflict detection (`repositories/quality.ts`, `conflicts.ts`),
`LeakageGuard`'s point-in-time query contract (`leakage-guard.ts`), and
Supabase/InMemory repositories for every entity
(`repositories/*.ts`). This is a distinct boundary from `FootballService`
above: it owns *data*, not predictions or decisions. See
`docs/architecture/FOOTBALL_DATA_ARCHITECTURE.md`,
`docs/architecture/DATA_QUALITY.md`, and
`docs/architecture/LEAKAGE_PROTECTION.md`.

No live provider is connected — see
`FOOTBALL_DATA_ARCHITECTURE.md`'s "Providers actually connected". Model/
statistical/ML computation, feature engineering, ensemble, calibration,
and decision logic (`feature-engineering.ts`, `feature-store.ts`,
`models/*`, `ensemble.ts`, `calibration.ts`, `decision.ts`,
`service.ts`) remain untouched, interface-only Section 01 placeholders —
Section 05's job, per this section's explicit instruction not to
pre-compute model features.

## Football Settlement Boundary

`Ticket`/`TicketSelection`/`MatchResult`/`Settlement` types, and the
critical rule — **an accumulator is one ticket regardless of selection
count** — are real and tested (`packages/settlement-engine/src/rules.ts`,
`rules.test.ts`). `PublishedPrediction` and `ExecutedWager` are
structurally distinct types; nothing in this codebase converts one into
the other automatically.

## What's explicitly deferred to later sections

- All model/statistical/ML computation, feature engineering, ensemble,
  calibration, decision logic (football-engine — deferred to Section 05
  specifically; aviator-engine — no section assigned yet).
- Real provider integrations (football data, odds — the adapter contract
  and pipeline are real as of Section 04, but no live credential exists;
  see `FOOTBALL_DATA_ARCHITECTURE.md`; Aviator data — untouched).
- Persistence for Telegram destinations, Ticket publication, Settlement,
  Reporting — Identity and License persistence landed in Section 03;
  these remain open.
- Real execution (any agent actually placing/confirming a wager).
- A concrete `JobScheduler` implementation (contract only today).
- `GlobalExecutionGate` wired to real identity/license/entitlement
  checks (the real services now exist — Section 03 — but connecting the
  gate to them is not this section's job).
- Direct Supabase Auth / RLS-reachable Mini App requests (today's Mini
  App traffic is entirely service-role-mediated via Edge Functions — see
  `docs/architecture/DATABASE_AND_RLS.md`'s "RLS identity helper").
- Device/session limit enforcement (`licenses.max_devices` exists;
  nothing enforces it yet — see `TELEGRAM_AUTHENTICATION.md`'s "Device
  limit foundation").
- A full owner/admin dashboard UI (Section 03 built the backend
  authorization foundation only, per the spec's explicit instruction).
