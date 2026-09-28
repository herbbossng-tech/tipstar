# Sport Intelligence OS

A production-grade sports intelligence platform covering Football and
Aviator, delivered through a Telegram Mini App and Bot, backed by
Supabase/PostgreSQL. Built progressively against the Master Blueprint
V1.0 — this repository currently implements **Section 01: Foundation,
Repository & Architecture**.

Section 01 is the technical skeleton every later section builds on: clean
module boundaries, typed contracts for every future service and agent,
configuration/logging/audit/health/error-handling foundations, and a
structural (not functional) frontend and bot. It intentionally does not
contain any intelligence engine, prediction logic, betting execution, or
fabricated data — see [Security Principles](#security-principles) and
[Data Integrity](#data-integrity) below.

## Repository layout

```
apps/
  mini-app/    Telegram Mini App (React + Vite + TypeScript)
    dashboard/   football/   aviator/   settings/   shared/
  bot/         Telegram Bot (grammy)

packages/
  shared/            Result type, typed error hierarchy, structured logger, id generation
  config/            Environment schema & typed config loader (zod)
  agent-core/        Agent contract, lifecycle state machine, AgentService registry
  telegram/          initData validation, webhook verification, destination validation,
                     publishing policy engine, TelegramService/PublishingService boundaries
  platform/          Identity, License, GlobalExecutionGate, Audit, Health, Reporting,
                     Scheduling contracts (see docs/architecture/MODULE_BOUNDARIES.md)
  risk-engine/       GlobalDailyRiskController (real) + sport-agnostic RiskService boundary
  market-engine/     Odds/market data boundary
  football-engine/   Football pipeline module boundaries (ingestion -> ... -> decision)
  aviator-engine/    Aviator pipeline module boundaries (ingestion -> ... -> signal)
  settlement-engine/ Ticket/Settlement types, the accumulator-is-one-ticket rule, boundaries

supabase/
  migrations/   Empty in Section 01 — see migrations/README.md
  functions/    health/ — the only real edge function so far
  seed/         Empty in Section 01

data/
  schemas/      Reserved for provider data schemas (Section 01: empty)
  fixtures/     Reserved for test fixtures (Section 01: empty)

tests/          Cross-package integration tests (package-level tests are colocated)
docs/
  architecture/ ARCHITECTURE.md, MODULE_BOUNDARIES.md, OPEN_QUESTIONS.md
  data/         Data leakage principle
  agents/       Agent core reference
  deployment/   Deployment notes
```

See [`docs/architecture/ARCHITECTURE.md`](./docs/architecture/ARCHITECTURE.md)
for the full architecture and [`docs/architecture/MODULE_BOUNDARIES.md`](./docs/architecture/MODULE_BOUNDARIES.md)
for what every package/service is (and is not yet) responsible for.

## Development setup

Prerequisites: Node.js >= 20, npm (this repo uses npm workspaces).

```bash
npm install
cp .env.example .env   # fill in local values; never commit a real .env
npm run dev             # Mini App dev server, http://localhost:5173
npm run dev:bot         # bot in long-polling mode (requires TELEGRAM_BOT_TOKEN)
```

Quality gates:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run check   # typecheck + lint + test
```

## Environment variables

Copy `.env.example` to `.env`. Full reference:
[`docs/environment-variables.md`](./docs/environment-variables.md).
`@sport-os/config`'s `loadServerConfig()`/`loadClientConfig()` are the
only supported way to read configuration — never read `process.env`/
`import.meta.env` directly elsewhere.

## Security principles

Locked into every later section (full detail in
[`docs/architecture/ARCHITECTURE.md`](./docs/architecture/ARCHITECTURE.md)):

1. The frontend is never the security boundary.
2. Secrets are server-side only.
3. Telegram identity must be verified server-side.
4. Authorization must be server-side.
5. RLS is mandatory once database tables exist (Section 03+).
6. Execution requires explicit authorization (see `GlobalExecutionGate`).
7. Automation must be independently controllable.
8. Risk controls have higher authority than execution.
9. Auditability is mandatory.
10. No security-control bypasses — no CAPTCHA/anti-bot bypass, no
    undocumented SportyBet API assumed.

## Data integrity

- No fabricated prediction results, win rates, odds, or performance
  statistics anywhere in this codebase — a value a provider or engine
  hasn't genuinely produced yet is `null`/a typed `NotImplementedError`,
  never a guess.
- Every future football feature must represent information genuinely
  available before kickoff — see
  [`docs/data/DATA_LEAKAGE_PRINCIPLE.md`](./docs/data/DATA_LEAKAGE_PRINCIPLE.md).
- No real-money betting execution, no bookmaker automation, and no
  security/anti-bot bypass exist in this codebase.

## Status

Section 01 is complete. See the final Section 01 report delivered in the
implementation session for what was built, tested, and any open
architectural questions
([`docs/architecture/OPEN_QUESTIONS.md`](./docs/architecture/OPEN_QUESTIONS.md)).
