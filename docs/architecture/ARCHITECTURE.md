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
├── mini-app/            Telegram Mini App (React + Vite + TS) — structural shell only
└── bot/                 Telegram Bot (grammy) — onboarding only, no automated publishing

packages/
├── shared/               Result type, typed error hierarchy (ValidationError,
│                         AuthenticationError, AuthorizationError, ConfigurationError,
│                         IntegrationError, DependencyUnavailableError,
│                         NotImplementedError, InternalError), structured logger + redaction
├── config/                Environment schema & typed config loader (zod); fails safe in production
├── agent-core/            Agent contract, BaseAgent lifecycle state machine, AgentService registry
├── telegram/              initData validation (real HMAC), webhook secret verification,
│                          destination validation, Publishing Policy Engine (real), Bot API
│                          client (real), Destination Manager / PublishingService (NotImplemented),
│                          TelegramAuthenticationService + stateless session tokens (real, Section 02)
├── platform/              Identity (real, database-backed — Section 03), License (real decision
│                          rule + real database-backed persistence, Section 03), Roles/Authorization
│                          (real, Section 03), Owner bootstrap (real, Section 03),
│                          GlobalExecutionGate (real orchestration), Audit (real, in-memory AND
│                          real database-backed — Section 03), Health (real), Reporting
│                          (NotImplemented), Scheduling (contract only)
├── risk-engine/           GlobalDailyRiskController (real) + sport-agnostic RiskService (NotImplemented)
├── market-engine/         Odds/market data boundary (NotImplemented)
├── football-engine/       ingestion, data-quality, feature-engineering, feature-store, models/
│                          {elo,form,xg,statistical,ml,monte-carlo}, ensemble, calibration,
│                          decision — all interface-only, no computation
├── aviator-engine/        ingestion, feature-engine, statistical-engine, ml-models, ensemble,
│                          confidence, signal-engine, risk, double-bet, performance-tracking —
│                          all interface-only, no computation
└── settlement-engine/     Ticket/TicketSelection/MatchResult/Settlement types, the
                           accumulator-is-one-ticket rule (real, tested), TicketService/
                           SettlementService (NotImplemented)
```

## Why two packages beyond the eight the blueprint named

The Master Blueprint's repository structure explicitly names 8 packages
(`football-engine`, `aviator-engine`, `risk-engine`, `market-engine`,
`settlement-engine`, `agent-core`, `telegram`, `shared`) and separately
asks for 14 backend/service boundaries. Two of those boundaries — cross-
cutting configuration and the platform-level concerns named under the
product definition's PLATFORM bucket (License & Access, Global Execution
Gate, Audit/Observability, Scheduling) — don't have a natural home in any
of the 8 without either overloading `shared` (violating "small cohesive
modules") or scattering config/audit/health across every consumer. Two
additional packages were added:

- **`packages/config`** — the "centralized configuration module with
  validation" the blueprint explicitly asks for, used by every app and
  server-side package.
- **`packages/platform`** — Identity, License, GlobalExecutionGate,
  Audit, Health, Reporting, Scheduling. Telegram Destination Manager and
  the Publishing Policy Engine (also PLATFORM-bucket items) live in
  `packages/telegram` instead, since they're Telegram-specific.

This is a physical-arrangement decision, not an architectural one — no
logical boundary the blueprint described was dropped, renamed, or merged
away; see `MODULE_BOUNDARIES.md` for exactly which service lives where.

## Data flow (once later sections implement it)

```
RAW DATA (provider ingestion)
   ↓
DATA QUALITY
   ↓
FEATURE ENGINEERING (point-in-time-safe — see docs/data/DATA_LEAKAGE_PRINCIPLE.md)
   ↓
MODELS (Elo / form / xG / statistical / ML / Monte Carlo)
   ↓
ENSEMBLE
   ↓
CALIBRATION
   ↓
DECISION / VALUE ENGINE  →  GlobalExecutionGate  →  Ticket/Signal
   ↓
DISTRIBUTION (Telegram, gated by Publishing Policy Engine)
   ↓
SETTLEMENT (against real match results / round outcomes)
   ↓
REPORTING / PERFORMANCE (derived only from real settled data)
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

See also:
- [`MODULE_BOUNDARIES.md`](./MODULE_BOUNDARIES.md)
- [`OPEN_QUESTIONS.md`](./OPEN_QUESTIONS.md)
- [`TELEGRAM_AUTHENTICATION.md`](./TELEGRAM_AUTHENTICATION.md)
- [`DATABASE_AND_RLS.md`](./DATABASE_AND_RLS.md)
- [`LICENSING.md`](./LICENSING.md)
- [`AUTHORIZATION.md`](./AUTHORIZATION.md)
- [`../data/DATA_LEAKAGE_PRINCIPLE.md`](../data/DATA_LEAKAGE_PRINCIPLE.md)
- [`../agents/AGENT_CORE.md`](../agents/AGENT_CORE.md)
