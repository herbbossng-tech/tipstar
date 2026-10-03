# Architecture Overview

## Purpose

Sport Intelligence OS is a production-grade sports intelligence platform
covering Football and Aviator: intelligence agents that produce evidence-
based assessments, a decision layer that turns those into published
tickets/signals, a risk layer with cross-cutting authority to halt
execution, a Telegram distribution layer, and settlement/reporting that
closes the loop on real outcomes. This document is the map of the system
established in Section 01; every later section extends it, per the Master
Blueprint V1.0, rather than replacing it.

## Main architecture (locked)

```
IDENTITY
  ↓
LICENSE / ENTITLEMENTS
  ↓
GLOBAL CONTROL
  ↓
INTELLIGENCE
  ↓
DECISION
  ↓
RISK
  ↓
EXECUTION
  ↓
DISTRIBUTION
  ↓
SETTLEMENT
  ↓
REPORTING
  ↓
AUDIT / PERFORMANCE
```

Every request that could result in an authorized action flows through
`GlobalExecutionGate` (`@sport-os/platform`), which encodes the IDENTITY →
LICENSE → ENTITLEMENT → RISK → INTEGRATION AVAILABILITY prefix of this
pipeline as a fixed-order, short-circuiting check pipeline. No package
implements an execution path that bypasses it.

## Package map

```
apps/
├── mini-app/            Telegram Mini App (React + Vite + TS) — real command-center UI
│                        as of Section 09: Home/Football/Tickets/Aviator/Performance/
│                        Account screens, a typed API client, 5 new read-only Supabase
│                        Edge Functions it calls (see "Section 09 boundaries" below).
│                        Presentation/read layer only — never the licensing, auth,
│                        prediction, decision, risk, settlement, or execution authority
└── bot/                 Telegram Bot (grammy) — onboarding only, no automated publishing

packages/
├── shared/               Result type, typed error hierarchy (ValidationError,
│                         AuthenticationError, AuthorizationError, ConfigurationError,
│                         IntegrationError, DependencyUnavailableError,
│                         NotImplementedError, InternalError), structured logger + redaction
├── config/                Environment schema & typed config loader (zod); fails safe in production
├── agent-core/            Agent contract, BaseAgent lifecycle state machine (+ per-invocation
│                          state machine, side-effect levels, typed failures, command/event
│                          messages, AgentOrchestrator, idempotency — Section 06), AgentService
│                          registry
├── agents/                The ten specialized agent implementations (Football Intelligence/
│                          Decision/Automation/Settlement/Weekly-Report, Telegram Channel
│                          Management, Aviator Intelligence/Risk/Automation, Performance) and
│                          their Supabase-backed persistence — real, Section 06. Each delegates
│                          its actual computation to an already-real Section 01–05 service; see
│                          docs/architecture/AGENT_CONTRACTS.md. SettlementAgent/PerformanceAgent
│                          now delegate to the real Section 08 settlement/performance engines too;
│                          risk-recording.ts's recordRealizedResult() (real, Section 08) is the one
│                          place a settled netPnl feeds the shared GlobalDailyRiskController
├── telegram/              initData validation (real HMAC), webhook secret verification,
│                          destination validation, Publishing Policy Engine (real), Bot API
│                          client (real), Destination Manager / PublishingService (NotImplemented),
│                          TelegramAuthenticationService + stateless session tokens (real, Section 02)
├── platform/              Identity (real, database-backed — Section 03), License (real decision
│                          rule + real database-backed persistence, Section 03), Roles/Authorization
│                          (real, Section 03), Owner bootstrap (real, Section 03),
│                          GlobalExecutionGate (real orchestration + real identity/license/
│                          entitlement/risk/integration-availability GateChecks — Section 07),
│                          Audit (real, in-memory AND real database-backed — Section 03), Health
│                          (real), Reporting (NotImplemented), Scheduling (contract only)
├── risk-engine/           GlobalDailyRiskController (real) + sport-agnostic RiskService
│                          (NotImplemented) + ticket-risk-engine.ts's evaluateTicketRisk()/
│                          evaluateAviatorDailyRisk() (real, Section 07 — extends RiskAssessment
│                          additively, reads the shared GlobalDailyRiskController)
├── market-engine/         Canonical MarketType (12 locked football markets), MarketObservation,
│                          fair-odds/implied-probability/overround math, checkOddsValidity() are
│                          real (Section 07 — types.ts). The live-odds-fetching MarketService
│                          (service.ts) remains NotImplemented (needs a real odds provider)
├── football-engine/       Data ingestion/normalization/quality/leakage-protection boundary
│                          (real, Section 04 — canonical model, provider adapters, quality
│                          engine, point-in-time query contract; see
│                          docs/architecture/FOOTBALL_DATA_ARCHITECTURE.md). Feature store,
│                          training dataset builder, walk-forward validation, baselines,
│                          statistical engine (Poisson/Dixon-Coles), Monte Carlo, ML models
│                          (Random Forest/Gradient Boosted Trees/Neural Network), ensemble,
│                          calibration, probability consistency, evaluation framework, and the
│                          prediction output contract are real (Section 05 — see
│                          docs/architecture/FOOTBALL_INTELLIGENCE.md). decision.ts's
│                          DecisionEngine (Value Engine + Decision Engine — StandardDecisionEngine),
│                          market-mapping.ts (probability→market), and ticket-engine.ts (Ticket
│                          Engine) are real (Section 07 — see
│                          docs/architecture/DECISION_ARCHITECTURE.md).
│                          NotImplementedDecisionEngine remains available for callers that
│                          haven't wired real ValueEngineDependencies/DecisionPolicy.
│                          settlement.ts (market settlement + accumulator aggregation + financial
│                          accounting) and backtest.ts (walk-forward settlement simulation, reusing
│                          Section 05/07 unmodified) are real (Section 08 — see
│                          docs/architecture/SETTLEMENT_ARCHITECTURE.md and
│                          docs/architecture/BACKTESTING_ARCHITECTURE.md)
├── aviator-engine/        ingestion, feature-engine, statistical-engine, ml-models, ensemble,
│                          confidence, risk, performance-tracking — all interface-only, no
│                          computation. signal-engine.ts's AviatorSignalState
│                          (BUY/SELL/WAIT/NO_TRADE/MONITOR) and double-bet.ts's DoubleBetRecord/
│                          buildDefaultDoubleBetLegs/settleDoubleBetLeg (the locked, real
│                          50/50-by-default Double Bet model) are real as of Section 06.
│                          settlement.ts's settleDoubleBet() (labels the existing real Double Bet
│                          arithmetic with the shared SettlementStatus state machine) is real
│                          (Section 08)
└── settlement-engine/     Ticket/TicketSelection/MatchResult/Settlement types (Section 01,
                           unchanged), the accumulator-is-one-ticket rule (real, tested),
                           TicketService/SettlementService (NotImplemented). Money/PayoutSource/
                           LedgerMode/SettlementRevision types, currency-safe financial
                           arithmetic (financial.ts), the sport-agnostic performance ledger
                           aggregator (performance.ts), and append-only settlement corrections
                           (revisions.ts) are real (Section 08 — see
                           docs/architecture/FINANCIAL_ACCOUNTING.md and
                           docs/architecture/PERFORMANCE_ARCHITECTURE.md)
```

## Why three packages beyond the eight the blueprint named

The Master Blueprint's repository structure explicitly names 8 packages
(`football-engine`, `aviator-engine`, `risk-engine`, `market-engine`,
`settlement-engine`, `agent-core`, `telegram`, `shared`) and separately
asks for 14 backend/service boundaries. Two of those boundaries — cross-
cutting configuration and the platform-level concerns named under the
product definition's PLATFORM bucket (License & Access, Global Execution
Gate, Audit/Observability, Scheduling) — don't have a natural home in any
of the 8 without either overloading `shared` (violating "small cohesive
modules") or scattering config/audit/health across every consumer. A
third addition, `packages/agents`, followed the same reasoning once
Section 06 needed a home for the actual specialized agent
implementations. Three additional packages were added:

- **`packages/config`** — the "centralized configuration module with
  validation" the blueprint explicitly asks for, used by every app and
  server-side package.
- **`packages/platform`** — Identity, License, GlobalExecutionGate,
  Audit, Health, Reporting, Scheduling. Telegram Destination Manager and
  the Publishing Policy Engine (also PLATFORM-bucket items) live in
  `packages/telegram` instead, since they're Telegram-specific.
- **`packages/agents`** (Section 06) — the ten specialized agent
  implementations (`FootballIntelligenceAgent`, `AviatorAutomationAgent`,
  ...) and their Supabase-backed persistence
  (`SupabaseInvocationsRepository`/`SupabaseIdempotencyStore`/
  `SupabaseAgentMessagesRepository`). `packages/agent-core` stays the
  framework (contract, lifecycle, orchestrator, messages, failures) and
  deliberately has no dependency on `platform`/`football-engine`/
  `telegram`/etc. (avoiding a circular dependency, since `platform`
  already depends on `agent-core`); `packages/agents` is the one place
  downstream of all of them where the actual agent classes live. See
  `docs/agents/AGENT_CORE.md` and `docs/architecture/AGENT_CONTRACTS.md`.

This is a physical-arrangement decision, not an architectural one — no
logical boundary the blueprint described was dropped, renamed, or merged
away; see `MODULE_BOUNDARIES.md` for exactly which service lives where.

## Data flow (once later sections implement it)

```
RAW DATA (provider ingestion)          — real, Section 04 (no live provider connected)
   ↓
DATA QUALITY                           — real, Section 04 (see DATA_QUALITY.md)
   ↓
TIME-AWARE DATA STORE / LEAKAGE GUARD  — real, Section 04 (see LEAKAGE_PROTECTION.md)
   ↓
FEATURE ENGINEERING (point-in-time-safe — see docs/data/DATA_LEAKAGE_PRINCIPLE.md)
   — real, Section 05 (see FOOTBALL_INTELLIGENCE.md)
   ↓
BASELINES / MODELS (Elo / Poisson / Dixon-Coles / Monte Carlo / Random Forest / GBT / Neural Network)
   — real, Section 05
   ↓
ENSEMBLE                               — real, Section 05
   ↓
CALIBRATION                            — real, Section 05
   ↓
PROBABILITY CONSISTENCY + OUTPUT CONTRACT — real, Section 05 (no ticket/wager decision yet)
   ↓
DECISION / VALUE ENGINE  →  TICKET ENGINE  →  RISK ENGINE
   →  GlobalExecutionGate  →  EXECUTION ADAPTER            — real, Section 07
   (no authorized bookmaker integration exists — every execution request
    terminates at NOT_AVAILABLE/MANUAL_REQUIRED; see DECISION_ARCHITECTURE.md)
   ↓
DISTRIBUTION (Telegram, gated by Publishing Policy Engine)   — Section 10
   ↓
SETTLEMENT (against real match results / round outcomes,     — real, Section 08
   append-only, versioned corrections)                          (see SETTLEMENT_ARCHITECTURE.md)
   ↓
REPORTING / PERFORMANCE (derived only from real settled data, — real, Section 08
   actual P&L/ROI/drawdown/losing-streak/CLV; paper/live         (see PERFORMANCE_ARCHITECTURE.md,
   strictly separated; backtesting reuses the same engine)       FINANCIAL_ACCOUNTING.md,
                                                                  BACKTESTING_ARCHITECTURE.md)
```

## Security principles (locked)

1. The frontend is never the security boundary — `apps/mini-app`'s
   `AuthBoundary` (Section 02: a real state-machine-driven flow) only
   *reflects* a server-verified identity; it never itself decides who a
   user is. See `docs/architecture/TELEGRAM_AUTHENTICATION.md`.
2. Secrets are server-side only — enforced today by
   `packages/config`'s `SERVER_ONLY_ENV_KEYS` and by `loadClientConfig()`
   only ever reading `VITE_`-prefixed vars.
3. Telegram identity must be verified server-side —
   `@sport-os/telegram`'s `validateInitData()` is the only place a
   Telegram user id may be trusted from; a client-asserted id (including
   `initDataUnsafe`) is never trusted directly. See
   `docs/architecture/TELEGRAM_AUTHENTICATION.md` for the full flow,
   including the Section 02 `TelegramAuthenticationService` and session
   token built on top of it.
4. Authorization must be server-side — see `GlobalExecutionGate`, and
   (Section 03) `@sport-os/platform`'s admin operations, each of which
   checks caller authorization before performing anything. See
   `docs/architecture/AUTHORIZATION.md`.
5. RLS is mandatory on every application table — enforced starting
   Section 03: `users`, `licenses`, `license_entitlements`,
   `license_limits`, `auth_sessions`, `audit_logs`, and
   `platform_settings` all have RLS enabled with no
   `USING (true)`/`WITH CHECK (true)` policy anywhere. See
   `docs/architecture/DATABASE_AND_RLS.md`.
6. Execution requires explicit authorization — every check in
   `GlobalExecutionGate`'s pipeline must return `{ allowed: true }`
   before an agent may execute.
7. Automation must be independently controllable — each automation agent
   (`football_automation`, `aviator_automation`) is its own `Agent`
   instance with its own lifecycle status; disabling one never disables
   another.
8. Risk controls have higher authority than execution —
   `GlobalDailyRiskController.isExecutionAllowed()` is designed to gate
   every future automation agent; once locked (`DAILY_TARGET_REACHED` /
   `DAILY_STOP_LOSS_REACHED`) it ignores further results until `reset()`.
9. Auditability is mandatory — every authorization outcome (permitted or
   denied) is a candidate `AuditEvent`; see `tests/agents/execution-pipeline.test.ts`
   for the pattern.
10. No security-control bypasses — no CAPTCHA/anti-bot bypass, no
    assumption that SportyBet exposes an undocumented public API (see
    `SPORTYBET_INTEGRATION_MODE`, currently `disabled` by default).

## Section 01 boundaries

- No model, statistical or ML, is implemented in `football-engine` or
  `aviator-engine` — every file there is an interface with a doc comment,
  not a computation.
- No real-money execution, bookmaker automation, or CAPTCHA/anti-bot
  bypass exists anywhere in this codebase.
- No fabricated prediction, odds, or performance data exists anywhere,
  including in tests (test fixtures use clearly synthetic values, e.g.
  `"Test Agent"`/`ticket-1`, never numbers presented as real statistics).

## Section 03 boundaries

- `supabase/migrations/` now has a real, non-empty production schema —
  see `docs/architecture/DATABASE_AND_RLS.md`.
- No fake users, licenses, or seed production customers were created —
  `supabase/seed/` remains empty; every test fixture (`tests/database/`,
  `*.test.ts`) uses clearly synthetic ids/names.
- Still no football/Aviator prediction logic, bookmaker execution, or
  SportyBet automation — unchanged from Section 01.
- `GlobalExecutionGate` still has no real identity/license/risk checks
  wired into its pipeline — Section 03 built the real `IdentityService`/
  `LicenseService` implementations the gate *could* use, but connecting
  them is not this section's job (see `AUTHORIZATION.md`).

## Section 04 boundaries

- `football-engine` now has a real data ingestion/normalization/quality/
  leakage-protection layer — see `FOOTBALL_DATA_ARCHITECTURE.md`,
  `DATA_QUALITY.md`, `LEAKAGE_PROTECTION.md`. Still no football
  prediction model, Sport Agent decision logic, ticket generation,
  bookmaker execution, SportyBet automation, or Telegram publishing
  logic beyond what already existed — unchanged from Sections 01–03.
- No live football/odds provider is connected — see
  `FOOTBALL_DATA_ARCHITECTURE.md`'s "Providers actually connected". The
  one adapter this section ships is a clearly-labeled deterministic test
  fixture provider, never presented as real data.
- No historical football data was fabricated — every record in the
  deterministic dataset uses obviously synthetic names/ids
  (`TFP-*`, "Test Arsenal", "Test Premier League").
- Mini App still never calls a football data provider directly — no
  football-facing Mini App endpoint exists yet; the data access boundary
  is enforced by absence (nothing in `apps/mini-app` imports
  `@sport-os/football-engine`), the same way it was before this section.

## Section 05 boundaries

- `football-engine` now has a real intelligence layer — feature store,
  training dataset builder, walk-forward validation, baselines,
  statistical engine, Monte Carlo, ML models (Random Forest/Gradient
  Boosted Trees/Neural Network — all from-scratch TypeScript, no ML
  runtime dependency added), ensemble, calibration, probability
  consistency, evaluation framework, and the prediction output contract
  — see `FOOTBALL_INTELLIGENCE.md`, `MODEL_VALIDATION.md`.
- No Sport Agent decision logic, ticket generation, value-selection
  policy, publishing policy, Telegram auto-publishing, bookmaker
  execution, or SportyBet automation was built — `decision.ts`/
  `service.ts` remain the Section 01 interface-only placeholders,
  unchanged. This section produces probabilities; Section 07 decides
  what to do with them.
- Still no live football/odds provider connected — unchanged from
  Section 04. Every intelligence computation this section validates is
  against the same deterministic synthetic dataset.
- No fabricated model performance — every accuracy/log-loss/Brier/ROC-
  AUC number in this codebase's tests comes from a real computation
  against synthetic data, explicitly labeled as such; no claim of
  real-world predictive accuracy is made anywhere.
- No arbitrary ensemble weights presented as optimal — every ensemble
  configuration is either a documented fixed baseline experiment or
  fit by a real, tested gradient-descent optimizer against a
  validation-period sample.

## Section 06 boundaries

- `agent-core`/`agents` now have a real agent framework — `BaseAgent`
  lifecycle, per-invocation state machine, side-effect levels, command/
  event messages, `AgentOrchestrator` (idempotent dispatch,
  `ExecutionAuthorizer` enforcement for `EXECUTION`/`REQUESTED_ACTION`-
  level agents), and all ten specialized agent implementations — see
  `AGENT_CONTRACTS.md`, `AGENT_SECURITY.md`, `../agents/AGENT_CORE.md`.
- `aviator-engine`'s Double Bet model (`double-bet.ts`) is real — two
  independent, concurrent targets, 50/50 by default, no martingale.
- Still no Value Engine logic, ticket-level/Aviator-daily risk
  evaluation, real `GlobalExecutionGate` checks, or real bookmaker
  execution — every agent that would need one of those depended on a
  typed boundary (`DecisionEngine`/`ExecutionIntegration`) whose only
  implementation explicitly said "not implemented." Section 07's job.

## Section 07 boundaries

- `football-engine`/`market-engine`/`risk-engine`/`platform` now have a
  real Decision + Value + Ticket + Risk + Execution-authorization layer —
  see [`DECISION_ARCHITECTURE.md`](./DECISION_ARCHITECTURE.md),
  [`VALUE_ENGINE.md`](./VALUE_ENGINE.md),
  [`TICKET_ENGINE.md`](./TICKET_ENGINE.md), and
  [`RISK_EXECUTION.md`](./RISK_EXECUTION.md) for the full design.
  `GlobalExecutionGate` now has real `identity`/`license`/`entitlement`/
  `risk`/`integration_availability` checks, assembled by
  `buildStandardGateChecks()` in the locked order.
- **Probability is still not a decision, value is still not risk
  authorization, a ticket proposal is still not an executed wager** — see
  `DECISION_ARCHITECTURE.md`'s "Why the layers can't collapse" for how
  this holds by construction, and
  `packages/agents/src/section07-adversarial.test.ts` for the 14 numbered
  adversarial proofs.
- No real bookmaker/exchange integration exists — `ExecutionIntegration`
  still has exactly one implementation
  (`NotImplementedExecutionIntegration`), so every execution request this
  codebase can produce terminates at `NOT_AVAILABLE`/`MANUAL_REQUIRED`,
  never a fabricated `EXECUTED` result.
- No settlement logic (`WON`/`LOST` determination, payout calculation),
  no weekly reporting beyond what Section 06 already built, no Telegram
  publishing infrastructure, no Mini App UI, no new agent framework or
  licensing system — `TicketStatus` stops at `EXECUTED`/`REJECTED`/
  `CANCELLED`; Section 08 and Section 10 remain untouched.
- 10 new migrations
  (`market_observations`/`value_evaluations`/`decisions`/`tickets`/
  `ticket_status_history`/`ticket_legs`/`risk_evaluations`/
  `execution_requests`/`execution_results` + their enums/RLS policies),
  admin-only RLS, `service_role` write-only — no existing RLS policy from
  any prior section was weakened. See `tests/database/
  100_section07_rls_cases.sql` (36 tests, validated against real
  PostgreSQL).

## Section 08 boundaries

- `settlement-engine`/`football-engine`/`aviator-engine`/`agents` now
  have a real Settlement + Financial Accounting + Performance +
  Backtesting layer — see
  [`SETTLEMENT_ARCHITECTURE.md`](./SETTLEMENT_ARCHITECTURE.md),
  [`FINANCIAL_ACCOUNTING.md`](./FINANCIAL_ACCOUNTING.md),
  [`PERFORMANCE_ARCHITECTURE.md`](./PERFORMANCE_ARCHITECTURE.md), and
  [`BACKTESTING_ARCHITECTURE.md`](./BACKTESTING_ARCHITECTURE.md) for the
  full design.
- **ANALYTICAL OUTCOME ≠ FINANCIAL OUTCOME, always** — a ticket's
  `SettlementStatus` (WON/LOST/VOID/PUSH/PENDING/CANCELLED) is always
  computed from real market data; `actualStake`/`actualPayout`/`netPnl`/
  `roi` stay `null` unless a real, confirmed execution exists. This holds
  by construction in `TicketSettlement`'s own fields, not by convention —
  see `FINANCIAL_ACCOUNTING.md`'s "The central rule."
  `packages/agents/src/section08-adversarial.test.ts`'s 28 numbered
  scenarios are the adversarial proof.
- An accumulator is still exactly ONE ticket at settlement, regardless of
  leg count (§13/§24) — `settleTicketLegs()` always produces one
  `TicketLegAggregation`; `buildPerformanceLedgerEntry()` always counts
  one `ticketCount` entry per settled record, never per leg.
- Settlement corrections are append-only — no `settlements` row is ever
  `UPDATE`d; a corrected outcome is always a new `settlement_revisions`
  row, folded by `resolveCurrentSettlement()` without discarding any
  prior revision.
- Backtesting reuses the real live pipeline (`evaluateValue()`,
  `createTicketDraft()`, `settleTicketLegs()`) end to end — never a
  second decision/settlement implementation — and is unconditionally
  `LedgerMode.PAPER`, so it can never write to a LIVE performance ledger.
- No real bookmaker/exchange integration still exists (unchanged from
  Section 07 — see question #19 in `OPEN_QUESTIONS.md`), so every
  settlement's `actualPayout`/`actualStake` in this codebase today is
  either `null` (unexecuted) or a caller-supplied test value — there is
  no live path yet by which a real `PROVIDER` payout is ever produced.
  No FX conversion layer exists either (question #23) — multi-currency
  performance stays strictly separated, never summed.
- No Telegram publishing, no weekly report UI, no new agent framework,
  no new bookmaker integration, no new licensing architecture — Sections
  10/11 remain untouched. (The Mini App dashboard itself is now real —
  see "Section 09 boundaries" below.)
- 6 new migrations (`settlements`/`settlement_legs`/
  `settlement_revisions`/`performance_ledger`/`backtest_runs`/
  `backtest_results` + their enums/RLS policies), admin-only RLS,
  `service_role` write-only — no existing RLS policy from any prior
  section was weakened. `backtest_runs` references Section 05's
  `intelligence_training_runs`/`intelligence_evaluation_runs` by FK
  rather than duplicating lineage columns. See
  `tests/database/120_section08_rls_cases.sql` (28 tests, validated
  against real PostgreSQL).

## Section 09 boundaries

- `apps/mini-app` now has a real command-center UI — six screens (Home,
  Football + fixture detail, Tickets + ticket detail, Aviator,
  Performance, Account), a typed API client, and 5 new read-only
  Supabase Edge Functions (`supabase/functions/football-fixtures`/
  `football-fixture-detail`/`tickets`/`ticket-detail`/
  `performance-summary`) built on top of every boundary above — see
  [`MINI_APP_ARCHITECTURE.md`](./MINI_APP_ARCHITECTURE.md),
  [`MINI_APP_SECURITY.md`](./MINI_APP_SECURITY.md),
  [`MINI_APP_DATA_CONTRACTS.md`](./MINI_APP_DATA_CONTRACTS.md), and
  [`MINI_APP_UX.md`](./MINI_APP_UX.md) for the full design.
- **The Mini App is presentation only** — it is never the licensing,
  authentication, prediction, value, decision, risk, settlement,
  financial, or execution authority. No domain value (probability, EV,
  fair odds, risk approval, settlement outcome, P&L) is ever computed in
  React; every figure is read verbatim from a real backend row.
  `apps/mini-app/src/security.test.ts` structurally enforces that no raw
  `fetch()` call bypasses the one centralized API client anywhere in the
  Mini App source.
- **UI gating is NOT authorization** — every new edge function
  independently re-verifies session + license + entitlement
  (`supabase/functions/_shared/auth.ts`) before querying anything; a
  client-side `hasEntitlement()` check only ever decides what to render.
- No ticket-creation or execution-confirmation write path was built — no
  Supabase repository persists `tickets`/`execution_requests`/
  `execution_results` yet (see `OPEN_QUESTIONS.md` #25), so building a
  write endpoint now would have meant inventing new persistence/business
  logic outside this section's UI-only scope. The Mini App's Ticket
  Center is therefore a pure read surface.
- No real Aviator data UI was built either — no Aviator signal/round/
  Double Bet persistence exists anywhere in this codebase (see
  `OPEN_QUESTIONS.md` #26); `AviatorPage` renders an honest "Aviator
  unavailable" empty state rather than inventing a signals table.
- No Telegram publishing, no weekly report UI, no owner/admin operations
  console, no new agent framework, no new bookmaker integration, no new
  licensing architecture — Sections 10/11 remain untouched.
- No new database migrations — every new edge function queries the
  already-real Section 04/05/07/08 schema via a service-role client;
  no RLS policy was added, changed, or weakened. `./tests/database/
  run.sh` (156 test markers across all prior sections' suites) remains
  green.

See also:
- [`DECISION_ARCHITECTURE.md`](./DECISION_ARCHITECTURE.md)
- [`VALUE_ENGINE.md`](./VALUE_ENGINE.md)
- [`TICKET_ENGINE.md`](./TICKET_ENGINE.md)
- [`RISK_EXECUTION.md`](./RISK_EXECUTION.md)
- [`FOOTBALL_INTELLIGENCE.md`](./FOOTBALL_INTELLIGENCE.md)
- [`SETTLEMENT_ARCHITECTURE.md`](./SETTLEMENT_ARCHITECTURE.md)
- [`FINANCIAL_ACCOUNTING.md`](./FINANCIAL_ACCOUNTING.md)
- [`PERFORMANCE_ARCHITECTURE.md`](./PERFORMANCE_ARCHITECTURE.md)
- [`BACKTESTING_ARCHITECTURE.md`](./BACKTESTING_ARCHITECTURE.md)
- [`MINI_APP_ARCHITECTURE.md`](./MINI_APP_ARCHITECTURE.md)
- [`MINI_APP_SECURITY.md`](./MINI_APP_SECURITY.md)
- [`MINI_APP_DATA_CONTRACTS.md`](./MINI_APP_DATA_CONTRACTS.md)
- [`MINI_APP_UX.md`](./MINI_APP_UX.md)
- [`MODEL_VALIDATION.md`](./MODEL_VALIDATION.md)
- [`FOOTBALL_DATA_ARCHITECTURE.md`](./FOOTBALL_DATA_ARCHITECTURE.md)
- [`DATA_QUALITY.md`](./DATA_QUALITY.md)
- [`LEAKAGE_PROTECTION.md`](./LEAKAGE_PROTECTION.md)
- [`MODULE_BOUNDARIES.md`](./MODULE_BOUNDARIES.md)
- [`OPEN_QUESTIONS.md`](./OPEN_QUESTIONS.md)
- [`TELEGRAM_AUTHENTICATION.md`](./TELEGRAM_AUTHENTICATION.md)
- [`DATABASE_AND_RLS.md`](./DATABASE_AND_RLS.md)
- [`LICENSING.md`](./LICENSING.md)
- [`AUTHORIZATION.md`](./AUTHORIZATION.md)
- [`AGENT_CONTRACTS.md`](./AGENT_CONTRACTS.md)
- [`AGENT_SECURITY.md`](./AGENT_SECURITY.md)
- [`../data/DATA_LEAKAGE_PRINCIPLE.md`](../data/DATA_LEAKAGE_PRINCIPLE.md)
- [`../agents/AGENT_CORE.md`](../agents/AGENT_CORE.md)
