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
| 4 | FootballService | `@sport-os/football-engine` | `service.ts` | NotImplemented — a distinct, still-unbuilt aggregate service. Note: `decision.ts`'s `DecisionEngine` (a *different*, already-fixed Section 01 contract in the same package) is **real** as of Section 07 — see "Decision / Value / Ticket / Risk / Execution Boundary" below. |
| 5 | AviatorService | `@sport-os/aviator-engine` | `service.ts` | NotImplemented (depends on the whole Aviator pipeline) |
| 6 | RiskService | `@sport-os/risk-engine` | `service.ts` | NotImplemented — no concrete class implements the generic `assess(agentType, proposedStake)` contract yet. Note: `GlobalDailyRiskController` (real, cross-sport daily kill switch) and, as of Section 07, `ticket-risk-engine.ts`'s `evaluateTicketRisk()`/`evaluateAviatorDailyRisk()` (real, `RiskAssessment`-shaped ticket/Aviator risk evaluation) are both **real** — see "Decision / Value / Ticket / Risk / Execution Boundary" below. |
| 7 | MarketService | `@sport-os/market-engine` | `service.ts` | NotImplemented (needs a real odds provider — this is a live-data-fetching aggregate service, distinct from `types.ts`, which is real as of Section 07: canonical `MarketType`/`MarketObservation`, fair-odds/implied-probability/overround math, `checkOddsValidity()`) |
| 8 | TicketService | `@sport-os/settlement-engine` | `service.ts` | NotImplemented — a distinct, still-unbuilt aggregate service; `@sport-os/football-engine/ticket-engine.ts`'s Ticket Engine (real, Section 07) is not this contract — see below. |
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
denial. As of Section 07, the individual checks are also **real**:
`createIdentityGateCheck`/`createLicenseGateCheck`/
`createEntitlementGateCheck`/`createRiskGateCheck`/
`createIntegrationAvailabilityGateCheck`, assembled in the locked order
by `buildStandardGateChecks()` (`execution-gate.ts`) — backed by the real
`UsersRepository`/`LicenseService` from Section 03, a pre-computed risk
result the caller supplies (never computed by the check itself — keeps
`platform` decoupled from `risk-engine`), and a duck-typed
`{ isAvailable(): Promise<boolean> }` target (never a direct
`@sport-os/agents` import, which would be circular). See
[`RISK_EXECUTION.md`](./RISK_EXECUTION.md).

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

## Decision / Value / Ticket / Risk / Execution Boundary (Section 07)

`@sport-os/football-engine`'s `decision.ts` (Value Engine + Decision
Engine) and new `market-mapping.ts`/`ticket-engine.ts`, plus
`@sport-os/market-engine`'s extended `types.ts`,
`@sport-os/risk-engine`'s new `ticket-risk-engine.ts`, and
`@sport-os/platform`'s extended `execution-gate.ts`, are all real, built
on top of the Football Intelligence Boundary above:

- **Market Engine** — canonical `MarketType` (12 locked football
  markets), `MarketObservation`, fair-odds/implied-probability/overround
  math, `checkOddsValidity()` (`market-engine/types.ts`).
- **Probability → Market mapping** — `market-mapping.ts` (lives in
  `football-engine`, not `market-engine`, to avoid a circular package
  dependency), deterministic, `MARKET_UNSUPPORTED` for the 7 markets
  today's Monte Carlo output can't derive.
- **Value Engine** — `evaluateValue()` (`decision.ts`): fair odds, edge,
  expected value, odds-validity gating, structured `DecisionReasonCode`s,
  the closed `DecisionOutcome` set.
- **Ticket Engine** — `createTicketDraft()`/`transitionTicketStatus()`/
  `validateTicket()` (`ticket-engine.ts`): SINGLE/ACCUMULATOR, immutable
  versioning, deterministic validation.
- **Risk Engine (ticket-level + Aviator daily)** — `evaluateTicketRisk()`/
  `evaluateAviatorDailyRisk()` (`ticket-risk-engine.ts`), extending
  Section 01's `RiskService`/`RiskAssessment` contract additively; reads
  the SHARED `GlobalDailyRiskController`, never a second ledger.
- **Global Execution Gate's real checks** — see "Global Execution Gate"
  above.
- **Execution contract** — `@sport-os/agents/execution-integration.ts`
  extended with `ExecutionResultStatus`, `validate()`/`status()`; still
  exactly one implementation (`NotImplementedExecutionIntegration`), so
  every execution request in this codebase terminates at
  `NOT_AVAILABLE`/`MANUAL_REQUIRED` — no authorized bookmaker integration
  exists.
- **Persistence** — 8 new tables (`market_observations`/
  `value_evaluations`/`decisions`/`tickets`/`ticket_status_history`/
  `ticket_legs`/`risk_evaluations`/`execution_requests`/
  `execution_results`), admin-only RLS, `service_role` write-only — same
  pattern as every prior section's operational tables.

This boundary owns *decisions, tickets, risk evaluation, and execution
authorization* — not settlement (Section 08) and not Telegram publishing
(Section 10). See [`DECISION_ARCHITECTURE.md`](./DECISION_ARCHITECTURE.md),
[`VALUE_ENGINE.md`](./VALUE_ENGINE.md), [`TICKET_ENGINE.md`](./TICKET_ENGINE.md),
and [`RISK_EXECUTION.md`](./RISK_EXECUTION.md) for the full design.

## Football Settlement Boundary

`Ticket`/`TicketSelection`/`MatchResult`/`Settlement` types, and the
critical rule — **an accumulator is one ticket regardless of selection
count** — are real and tested (`packages/settlement-engine/src/rules.ts`,
`rules.test.ts`). `PublishedPrediction` and `ExecutedWager` are
structurally distinct types; nothing in this codebase converts one into
the other automatically. Real market-grading settlement, financial
accounting, and performance aggregation now exist on top of this — see
"Settlement, Financial Accounting, Performance & Backtesting Boundary
(Section 08)" below.

## Settlement, Financial Accounting, Performance & Backtesting Boundary (Section 08)

`@sport-os/settlement-engine`'s new `financial.ts`/`performance.ts`/
`revisions.ts`, `@sport-os/football-engine`'s new `settlement.ts`/
`backtest.ts`, and `@sport-os/aviator-engine`'s new `settlement.ts` are
all real, built on top of the Decision/Value/Ticket/Risk/Execution
Boundary above:

- **Financial primitives** — `Money`, `PayoutSource` (PROVIDER vs
  CALCULATED), `LedgerMode` (PAPER vs LIVE), `SettlementRevision`
  (`settlement-engine/types.ts`); currency-safe arithmetic, net P&L, ROI
  (`financial.ts`); append-only correction chain
  (`revisions.ts`) — all sport-agnostic, since `settlement-engine` has
  zero cross-domain dependencies and both `football-engine` and
  `aviator-engine` now depend on it (a new, one-directional dependency
  added this section; confirmed no cycles).
- **Football market settlement** — `settleMarket()`/`settleLeg()`/
  `settleTicketLegs()`/`settleTicket()` (`football-engine/settlement.ts`):
  deterministic grading for 1X2, Double Chance, BTTS, Over/Under, Correct
  Score, European Handicap, supported-line Asian Handicap, 1H/2H; the
  §13 accumulator aggregation policy (`FOOTBALL_SETTLEMENT_POLICY_VERSION`).
- **Backtesting/walk-forward integration** — `simulateBacktestDecision()`
  (`football-engine/backtest.ts`): reuses the SAME `evaluateValue()`/
  `createTicketDraft()`/`settleTicketLegs()` a live decision uses, adds
  only the `BACKTEST_FUTURE_ODDS` leakage guard and grading against a
  `TrainingExample`'s own historical label; always `LedgerMode.PAPER`.
  Never rebuilds Section 05's walk-forward/feature/model logic.
- **Aviator + Double Bet settlement** — `settleDoubleBet()`
  (`aviator-engine/settlement.ts`): labels Section 06's already-real
  `combineDoubleBetLegs()` arithmetic with the shared `SettlementStatus`
  state machine; recomputes no stake/exit/return math.
- **Performance ledger** — `buildPerformanceLedgerEntry()`
  (`settlement-engine/performance.ts`): the one, sport-agnostic
  aggregation algorithm every ledger entry (football, Aviator, backtest)
  goes through, via a thin `toPerformanceRecordInput()` adapter per
  domain. Drawdown/losing-streak math also lives here, shared by
  `PerformanceAgent` (which no longer keeps a private copy).
- **Realized P&L → risk feedback** — `recordRealizedResult()`
  (`agents/risk-recording.ts`): the one place a settled `netPnl` is fed
  into the SHARED `GlobalDailyRiskController`; deliberately standalone,
  never bundled into a read-only agent's `execute()`.
- **Settlement/Performance agent extension** — `SettlementAgent`'s new
  `richTicket` path calls `settleTicket()` directly (§38's "must NOT
  duplicate settlement mathematics"); `PerformanceAgent`'s new
  `footballSettlements`/`doubleBetSettlements` inputs feed the shared
  aggregator (§39's "must NOT alter settlement outcomes... must NOT
  fabricate missing financial values"). Both legacy Section 06 contracts
  remain 100% backward compatible.
- **Persistence** — 6 new tables (`settlements`/`settlement_legs`/
  `settlement_revisions`/`performance_ledger`/`backtest_runs`/
  `backtest_results`), admin-only RLS, `service_role` write-only, real
  idempotency `UNIQUE` constraints — same pattern as every prior
  section's operational tables. `backtest_runs` references Section 05's
  `intelligence_training_runs`/`intelligence_evaluation_runs` by FK
  rather than duplicating window/model/dataset columns.

This boundary owns *settlement, financial accounting, performance
reporting, and backtesting simulation* — never Telegram publishing
(Section 10) and never weekly/operational reporting (Section 11). See
[`SETTLEMENT_ARCHITECTURE.md`](./SETTLEMENT_ARCHITECTURE.md),
[`FINANCIAL_ACCOUNTING.md`](./FINANCIAL_ACCOUNTING.md),
[`PERFORMANCE_ARCHITECTURE.md`](./PERFORMANCE_ARCHITECTURE.md), and
[`BACKTESTING_ARCHITECTURE.md`](./BACKTESTING_ARCHITECTURE.md) for the
full design.

## Mini App Command Center Boundary (Section 09)

`apps/mini-app` and 5 new `supabase/functions/*` edge functions
(`football-fixtures`/`football-fixture-detail`/`tickets`/
`ticket-detail`/`performance-summary`) are real, built as a pure
**presentation and read layer** on top of every boundary above — it is
never itself the licensing/authentication/prediction/value/decision/
risk/settlement/financial/execution authority (Section 09's own
explicit list of what it is NOT):

- **API client + view models** — `services/api.ts`'s `authedGet`/
  `buildQueryString`, `api/types.ts`'s locally-defined, byte-identical-
  enum view models (mirroring `auth/types.ts`'s precedent — server
  packages are never imported into the browser bundle).
- **6 screens** — Home, Football (+ fixture detail), Tickets (+ ticket
  detail), Aviator, Performance, Account — replacing Section 01's
  structural placeholders, all reading real Section 04/05/07/08 data,
  none computing a domain value themselves.
- **`useQuery`** — the one data-fetching primitive (loading/error/
  success, race-condition-safe via a generation counter, `refetch()`).
- **Shared component library** — `StatusBadge`/`EmptyState`/
  `QueryErrorState`/`LoadingState`/`LicenseCard`/`FixtureCard`/
  `ValueCard`/`DecisionBadge`/`TicketCard`/`TicketLegRow`/
  `PerformanceMetric`, backed by two pure logic modules
  (`statusPresentation.ts`, `format.ts`).
- **Telegram theme integration** — `useTelegramTheme()` applies real
  `colorScheme`/`themeParams` as CSS custom properties, falling back to
  the existing `prefers-color-scheme` defaults outside Telegram.
- **Every new edge function independently re-verifies** session +
  license + entitlement (`supabase/functions/_shared/auth.ts`'s
  `resolveAuthenticatedUser`/`requireEntitlement`) — UI-level
  entitlement checks (`hasEntitlement()`) are a rendering convenience
  only, never a security boundary.

**What was deliberately not built**: ticket creation and assisted-
execution confirmation (no Supabase repository persists `tickets`/
`execution_requests`/`execution_results` yet — see `OPEN_QUESTIONS.md`
#25) and a real Aviator data UI (no Aviator signal/round/Double Bet
persistence exists anywhere in this codebase — see `OPEN_QUESTIONS.md`
#26, and "Aviator + Double Bet Engine (Section 06)" above). Both are
documented, not silently worked around.

This boundary owns *presentation of already-computed state and read-only
orchestration of authorized requests* — never Telegram publishing
(Section 10) and never owner/admin operations (Section 11). See
[`MINI_APP_ARCHITECTURE.md`](./MINI_APP_ARCHITECTURE.md),
[`MINI_APP_SECURITY.md`](./MINI_APP_SECURITY.md),
[`MINI_APP_DATA_CONTRACTS.md`](./MINI_APP_DATA_CONTRACTS.md), and
[`MINI_APP_UX.md`](./MINI_APP_UX.md) for the full design.

## Telegram Bot, Multi-Channel Management & Automated Publishing Boundary (Section 10)

`apps/bot` (grammy, real command routing), `packages/telegram`'s new
Bot API client/policy engine/template engine, and
`packages/agents`'s new destination manager/publishing authorizer are
real, built as a pure **distribution layer** downstream of every
boundary above. "Telegram is DISTRIBUTION. It is not DECISION/RISK/
EXECUTION/SETTLEMENT" — this boundary decides WHERE/WHEN/HOW/WHICH
destination a FINALIZED piece of content reaches, never WHAT the
prediction/odds/value should be, WHETHER to execute, WHETHER it won, or
WHAT the payout is:

- **`TelegramBotApiService`** (`packages/telegram/src/service.ts`) — the
  one server-only Bot API client (`sendMessage`/`replyToMessage`/
  `getChat`/`getChatMember`), with real error categorization
  (`telegram-errors.ts`), bounded retry/backoff, and per-attempt
  timeout.
- **Publishing Policy Engine** (`packages/telegram/src/policy-engine.ts`)
  — `evaluatePublicationPolicy()` extends (never duplicates)
  Section 06's `evaluatePublishingPolicy()` with markets/leagues/data-
  quality/model-agreement/daily-limit/publication-window checks, every
  field sourced from a real existing backend field (`FeatureQuality`,
  `TicketRiskLimits.minimumModelAgreementRatio`) — there is no
  "confidence" field anywhere in this policy.
- **Message template engine** (`packages/telegram/src/templates.ts`) —
  pure, deterministic, HTML-escaped renderers for pick/ticket/booking-
  code/result/performance messages; an accumulator is rendered as ONE
  message with N numbered legs, never N separate messages; a NULL
  financial field renders as "Not available," never coerced to zero.
- **Destination manager** (`packages/agents/src/destination-manager.ts`)
  — OWNER/ADMIN-gated `createDestination`/`verifyDestination`/
  `updateDestinationSettings`/`disableDestination`/`listDestinations`/
  `getDestination`, mirroring `packages/platform/src/user-admin.ts`'s
  exact pattern; a destination starts UNVERIFIED and only a real
  `getChat` success ever marks it VERIFIED.
- **`PublishingAuthorizer`** (`packages/agents/src/publishing-
  authorizer.ts`) — a wholly separate class from `GlobalExecutionGate`,
  reusing its identity/license/entitlement `GateCheck` factories without
  ever constructing a second gate; this is what `AgentOrchestrator`
  calls before `TelegramChannelManagementAgent.execute()` ever runs.
- **`TelegramChannelManagementAgent`** (extended, not replaced) —
  durable per-destination idempotency via `TelegramPublicationsRepository`
  (a database-enforced natural-key unique index, not an in-memory key),
  RESULTS-publication reply-to-original (§22), and multi-destination
  fanout where one destination's failure never marks another as failed.
- **Bot command routing** (`apps/bot/src/bot.ts`/`commands/handlers.ts`)
  — `Update -> Parser -> Authenticated Context -> Authorization ->
  Domain Service -> Response Renderer`; every command resolves identity
  from grammy's own `ctx.from` only (Telegram's own update delivery is
  the trust boundary here), never from a command argument; `/football`/
  `/tickets`/`/performance` deep-link to the Mini App rather than
  reimplementing Section 09's queries a third time; `/aviator` gives the
  same honest unavailability the Mini App gives (`OPEN_QUESTIONS.md`
  #26, still unresolved).

**What was deliberately not built**: a publication job queue (publishing
is synchronous per destination; bounded retry happens inline inside
`TelegramBotApiService` — see `TELEGRAM_PUBLISHING_ARCHITECTURE.md`'s
"Why no job queue"), inline callback buttons (only URL buttons exist, so
there is no callback-query attack surface to defend), a real bookmaker
booking-code integration (booking codes remain downstream-only, per
`OPEN_QUESTIONS.md`), and a full admin ops console (only the destination-
management capabilities Section 10 itself needs were built — see
`OPEN_QUESTIONS.md` #29 on why `/football`/`/tickets`/`/performance`
deep-link instead of querying directly).

This boundary owns *Telegram bot interaction, destination management,
and publication of already-finalized content* — never prediction,
decision, risk, execution, settlement, or weekly reporting (Section 11).
See [`TELEGRAM_PUBLISHING_ARCHITECTURE.md`](./TELEGRAM_PUBLISHING_ARCHITECTURE.md),
[`TELEGRAM_DESTINATIONS.md`](./TELEGRAM_DESTINATIONS.md),
[`PUBLISHING_POLICY.md`](./PUBLISHING_POLICY.md), and
[`TELEGRAM_SECURITY.md`](./TELEGRAM_SECURITY.md) for the full design.

## Automation Operations, Licensing Administration & Reporting Boundary (Section 11)

`packages/platform/src/operations/*` and `packages/agents/src/jobs/*` +
`operations/agent-operations.ts` + `weekly-report-service.ts` are real,
built as an **operations control plane** downstream of every boundary
above — never a second domain engine:

- **License administration** (`operations/license-admin.ts`) adds only
  `renewLicense`/`reactivateLicense`/`listUsersForAdmin`/
  `inspectUserForAdmin` — `createLicense`/`suspendLicense`/
  `revokeLicense`/`assignEntitlement`/`removeEntitlement`/
  `setLicenseLimit` already existed (Section 03) and are reused as-is,
  never duplicated.
- **Authorization matrix** (`operations/authorization-matrix.ts`) is a
  read-only, presentation-only `canPerform()` — the real authority is
  still each call site's own `requireAdmin()`/`requireOwner()`.
- **A durable job queue** (`operations/jobs.ts` + `operational_jobs`
  table, claimed via `claim_next_operational_job()`'s
  `FOR UPDATE SKIP LOCKED`) now exists for exactly four job types
  (`WEEKLY_REPORT_GENERATION`/`TELEGRAM_REPORT_PUBLICATION`/
  `PERFORMANCE_SNAPSHOT`/`OPERATIONAL_HEALTH_CHECK`), each with a real
  handler in `packages/agents/src/jobs/*` — `OperationalJobWorker` never
  trusts a job's payload/creator as authorization.
- **Weekly reporting** (`weekly-report-service.ts`) reads the real
  `performance_ledger` (written, for the first time, by
  `PerformanceSnapshotJobHandler` from the real `settlements` table via
  the already-real `buildPerformanceLedgerEntry()`) and publishes
  through the existing Telegram publishing path
  (`AgentOrchestrator.dispatch()` to `TelegramChannelManagementAgent`) —
  never a direct Telegram API call, never a second aggregation
  algorithm. Reports are insert-only, versioned via
  `supersedes_report_id`, never overwritten.
- **Operational visibility** (`operations/agent-operations.ts`) composes
  the existing `InvocationsRepository`/`AgentInvocationRecord` (Section
  06) into admin-facing counts — it adds no retry/re-run of an agent
  invocation directly; a job retry is the only "retry" surface.

**What was deliberately not built**: a standalone deployed process that
calls `OperationalJobWorker.runOnce()` on a schedule (the worker and
every handler are real and tested; nothing yet runs the loop — see
`OPEN_QUESTIONS.md`), the full Licenses/Users/Agents/Audit/System admin
Mini App screens (Home/Jobs/Reports only), and a dedicated settlements-
connectivity health probe (`OPERATIONAL_HEALTH_CHECK` reports that
subsystem `UNKNOWN`, never a fabricated `HEALTHY`).

This boundary owns *license/entitlement administration, durable job
scheduling, operational visibility, and weekly reporting* — never
prediction, decision, risk, execution, or settlement calculation, and
never a second Telegram publishing pipeline. See
[`SECTION_11_OPERATIONS_ARCHITECTURE.md`](./SECTION_11_OPERATIONS_ARCHITECTURE.md),
[`LICENSE_ADMINISTRATION.md`](./LICENSE_ADMINISTRATION.md),
[`JOBS_AND_SCHEDULING.md`](./JOBS_AND_SCHEDULING.md),
[`WEEKLY_REPORTING.md`](./WEEKLY_REPORTING.md), and
[`OPERATIONS_SECURITY.md`](./OPERATIONS_SECURITY.md) for the full design.

## What's explicitly deferred to later sections

- Value-selection policy math (`DecisionEngine.assess()`), ticket-level
  and Aviator-daily risk evaluation, `GlobalExecutionGate`'s real
  identity/license/entitlement/risk/integration-availability checks, and
  settlement/financial-accounting/performance/backtesting calculation are
  all now **real** — see "Decision / Value / Ticket / Risk / Execution
  Boundary (Section 07)" and "Settlement, Financial Accounting,
  Performance & Backtesting Boundary (Section 08)" above. Still deferred:
  stake sizing beyond `authorizeTicketStake()`'s "the caller supplies a
  real number, this module never invents one," a real bookmaker/exchange
  integration (the typed `ExecutionIntegration` boundary exists; its only
  implementation reports itself unavailable — so every Section 08
  settlement's `actualPayout`/`actualStake` remains `null` in practice
  until one exists), SportyBet automation, and an FX conversion layer
  (multi-currency amounts stay strictly separated, never summed). Weekly
  reporting of settlement results is now real (Section 11), bounded to
  the `(ledgerMode, ticketType)` breakdown `PerformanceSnapshotJobHandler`
  persists — no league/market/model/policy breakdown yet. All model/
  statistical/ML computation for Aviator (`aviator-engine` — no section
  assigned yet).
- Real provider integrations (football data, odds — the adapter contract
  and pipeline are real as of Section 04, but no live credential exists;
  see `FOOTBALL_DATA_ARCHITECTURE.md`; Aviator data — untouched).
- Reporting persistence landed in Section 11 (`weekly_reports`,
  `performance_ledger` writes). Identity and License persistence landed
  in Section 03; Settlement persistence landed in Section 08; Telegram
  destination/publication persistence landed in Section 10.
- Real execution (any agent actually placing/confirming a wager) — the
  typed `ExecutionIntegration` boundary (`@sport-os/agents`, extended
  Section 07 with `validate()`/`status()`/`ExecutionResultStatus`) both
  automation agents call has exactly one implementation,
  `NotImplementedExecutionIntegration`, which always reports itself
  unavailable; a real, authorized bookmaker/exchange integration remains
  unbuilt.
- A concrete `JobScheduler` implementation (contract only today).
- Direct Supabase Auth / RLS-reachable Mini App requests (today's Mini
  App traffic is entirely service-role-mediated via Edge Functions — see
  `docs/architecture/DATABASE_AND_RLS.md`'s "RLS identity helper").
- Device/session limit enforcement (`licenses.max_devices` exists;
  nothing enforces it yet — see `TELEGRAM_AUTHENTICATION.md`'s "Device
  limit foundation").
- A full owner/admin dashboard UI (Section 03 built the backend
  authorization foundation only, per the spec's explicit instruction).
