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
| 4 | FootballService | `@sport-os/football-engine` | `service.ts` | NotImplemented (depends on Section 07's decision logic; both the data layer and the full intelligence/prediction layer it will eventually read from are now real — see "Football Data Boundary" and "Football Intelligence Boundary" below) |
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
contract, lifecycle, per-invocation state machine, command/event
messages, `AgentOrchestrator`, idempotency, and how every named agent in
the product definition maps to `AgentType`.

## Agent Framework (Section 06)

All ten specialized agents (every `AgentType` except
`global_daily_risk_controller`, deliberately never wrapped as a peer
agent) are real, tested `BaseAgent` implementations in
`@sport-os/agents` — each delegates its actual computation to an
already-real Section 01–05 service/engine or a typed boundary whose only
implementation explicitly says "not implemented" (`DecisionEngine`/
`ExecutionIntegration`/`SettlementService`), never inventing Section
07+ business logic itself. See
[`AGENT_CONTRACTS.md`](./AGENT_CONTRACTS.md) for every agent's
capabilities/dependencies/side-effect level, and
[`AGENT_SECURITY.md`](./AGENT_SECURITY.md) for the authorization/
execution-boundary rules. `agent_invocations`/`agent_messages`/
`agent_idempotency_claims` (real Supabase tables, RLS-protected,
admin-only or service-role-only) are the durable persistence.

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
`FOOTBALL_DATA_ARCHITECTURE.md`'s "Providers actually connected".
Sport Agent decision logic (`decision.ts`, `service.ts`) remains
untouched, interface-only Section 01 placeholders — Section 07's job.

## Football Intelligence Boundary (Section 05)

`@sport-os/football-engine`'s feature/model layer is real, built on top
of the Football Data Boundary above:

- **Feature store** — `features/*.ts` (Elo, Form, Rest/Schedule,
  Home/Away, H2H, Odds families real; xG/Team Statistics/Standings
  declared but disabled — no canonical data source yet),
  `feature-engineering.ts`/`feature-store.ts`.
- **Training dataset builder** — `dataset/builder.ts` (1X2/total-goals/
  BTTS labels).
- **Walk-forward validation** — `validation/walk-forward.ts` (chronological
  only, expanding window).
- **Baselines** — `baselines.ts` (naive/historical-frequency/Elo/
  Poisson/market-implied).
- **Statistical engine** — `statistical/poisson.ts`,
  `statistical/dixon-coles.ts`.
- **Monte Carlo** — `monte-carlo.ts` (seeded, deterministic).
- **ML models** — `models/*.ts` (Random Forest, Gradient Boosted Trees,
  Neural Network — all from-scratch TypeScript, no ML runtime
  dependency; see `MODEL_VALIDATION.md`'s "ML runtime boundary").
- **Ensemble** — `ensemble.ts` (configured-baseline or learned weights,
  never arbitrary).
- **Calibration** — `calibration.ts` (Platt + isotonic, time-safe
  selection).
- **Probability consistency** — `probability/consistency.ts` (fail-closed
  validation every model output passes through).
- **Evaluation framework** — `evaluation/*.ts` (predictive-quality
  metrics only, no ROI/profit).
- **Prediction output contract** — `output-contract.ts` (fair odds,
  explicit probability-vs-confidence distinction, no certainty language).
- **Persistence** — 6 new tables (`intelligence_dataset_versions`/
  `intelligence_model_versions`/`intelligence_calibration_versions`/
  `intelligence_ensemble_versions`/`intelligence_training_runs`/
  `intelligence_evaluation_runs`), admin-only RLS, `service_role`
  write-only — same pattern as Section 04's operational tables.

This boundary owns *intelligence* (probabilities, versioned model
artifacts, evaluation metrics) — not decisions. See
`docs/architecture/FOOTBALL_INTELLIGENCE.md` and
`docs/architecture/MODEL_VALIDATION.md` for the full design. No Sport
Agent decision/ticket/value-selection/publishing logic, bookmaker
execution, or SportyBet automation was built — Section 07's job.

## Football Settlement Boundary

`Ticket`/`TicketSelection`/`MatchResult`/`Settlement` types, and the
critical rule — **an accumulator is one ticket regardless of selection
count** — are real and tested (`packages/settlement-engine/src/rules.ts`,
`rules.test.ts`). `PublishedPrediction` and `ExecutedWager` are
structurally distinct types; nothing in this codebase converts one into
the other automatically.

## What's explicitly deferred to later sections

- Value-selection policy math itself (`DecisionEngine.assess()`'s real
  implementation — the Football Decision Agent, Section 06, calls it but
  doesn't implement it), stake sizing, final risk authorization beyond
  consulting the shared `GlobalDailyRiskController`/`GlobalExecutionGate`,
  bookmaker execution, SportyBet automation — deferred to Section 07; the
  full intelligence layer feeding it (Section 05) and the agent
  orchestration layer requesting it (Section 06) are now real, see
  "Football Intelligence Boundary" and "Agent Framework (Section 06)"
  above. All model/statistical/ML computation for Aviator (aviator-engine
  — no section assigned yet).
- Real provider integrations (football data, odds — the adapter contract
  and pipeline are real as of Section 04, but no live credential exists;
  see `FOOTBALL_DATA_ARCHITECTURE.md`; Aviator data — untouched).
- Persistence for Telegram destinations, Ticket publication, Settlement,
  Reporting — Identity and License persistence landed in Section 03;
  these remain open.
- Real execution (any agent actually placing/confirming a wager) — the
  typed `ExecutionIntegration` boundary (`@sport-os/agents`, Section 06)
  both automation agents call has exactly one implementation,
  `NotImplementedExecutionIntegration`, which always reports itself
  unavailable; a real bookmaker integration is still Section 07+.
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
