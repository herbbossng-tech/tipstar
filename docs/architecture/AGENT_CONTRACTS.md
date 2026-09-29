# Agent Contracts

Every agent Section 06 implements, its capabilities, its dependencies,
and — critically — what it does NOT do. See
[`../agents/AGENT_CORE.md`](../agents/AGENT_CORE.md) for the shared
framework (lifecycle, invocation state machine, messages, orchestrator,
idempotency, failures) every agent below builds on, and
[`AGENT_SECURITY.md`](./AGENT_SECURITY.md) for the authorization/
execution-boundary rules that apply across all of them.

## Football agents

### Football Intelligence Agent (`football_intelligence`)

`packages/agents/src/football/intelligence-agent.ts`

- **Side-effect level:** `ANALYSIS`
- **Consumes:** an already-built Section 05 `PredictionOutput`
  (`buildPredictionOutput()` — real `LeakageGuard.getDataAsOf()` +
  ensemble + calibration) and the raw `EnsembleComponentPrediction[]`
  that fed it.
- **Produces:** `FootballIntelligenceResult` — the prediction passed
  through untouched, plus `modelAgreement` (cross-model top-pick
  agreement, computed only from the components it's given), `dataQuality`,
  `warnings`, and `eligibility`.
- **Computes NOTHING about probabilities itself** — every number in
  `result.prediction` is byte-identical to what Section 05 produced.
- **Never:** chooses a bet, declares a "best market," constructs an
  accumulator, sets a stake, executes anything, publishes anything. The
  output type has no field capable of representing any of those.

### Football Decision/Ticket Agent (`football_decision`)

`packages/agents/src/football/decision-agent.ts`

- **Side-effect level:** `PROPOSAL`
- **Depends on:** `football_intelligence` (consumes its output);
  `DecisionEngine` (`@sport-os/football-engine/decision.ts` — the
  Section 07 Value Engine boundary; `NotImplementedDecisionEngine` is
  the only implementation that exists today).
- **Produces:** `TicketProposal` — only the candidate markets
  `DecisionEngine.assess()` reported `qualifies: true` become legs;
  every assessment (qualifying or not) is kept for provenance.
- **Every value judgment is delegated** to the injected `DecisionEngine`
  — this agent computes zero expected-value math itself.
- **Never:** bypasses the Value Engine, Risk Engine, `GlobalExecutionGate`,
  license, or entitlement checks (those live in the orchestrator/gate,
  never duplicated here). `TicketProposal` is a NEW, agent-layer type —
  never `@sport-os/settlement-engine`'s `Ticket` (which already means
  "published") or `ExecutedWager`. **PREDICTION ≠ TICKET PROPOSAL ≠
  EXECUTED TICKET.**

### Football Automation Agent (`football_automation`)

`packages/agents/src/football/automation-agent.ts`

- **Side-effect level:** `EXECUTION` (its declared ceiling — the
  orchestrator requires `GlobalExecutionGate` authorization before this
  agent ever runs at this level)
- **Depends on:** `ExecutionIntegration` (`../execution-integration.ts`)
  — the one typed boundary that could place a real wager;
  `NotImplementedExecutionIntegration` (always reports itself
  unavailable) is the only implementation in this codebase.
- **Supports** `MANUAL` (always `MANUAL_REQUIRED`, never touches the
  integration), `ASSISTED` (requires `userConfirmed: true` — an explicit
  flag the caller must have obtained from a genuine user action, never
  inferred from opening a screen), `AUTOMATIC` (still requires the
  orchestrator's `GlobalExecutionGate` pass).
- **Never:** invents a bookmaker API, bypasses authentication/CAPTCHA/
  anti-bot controls, executes without authorization, fakes an execution
  result. No integration available → `NOT_AVAILABLE`, always.

### Settlement Agent (`settlement`)

`packages/agents/src/football/settlement-agent.ts`

- **Side-effect level:** `REQUESTED_ACTION`
- **Depends on:** `SettlementService` (`@sport-os/settlement-engine`) —
  settlement math itself is NOT this agent's job (§38 explicitly
  excludes "settlement calculations beyond the agent contract boundary");
  `NotImplementedSettlementService` is the only implementation today.
- **Produces:** the `Settlement` the service returns, plus
  `originalTicket` — a defensive structural copy proving (see the
  agent's own tests) that settling never mutates the ticket/prediction
  it was given.
- A 5-leg accumulator settles as exactly ONE `Settlement` record — this
  agent settles the one `Ticket` it's given, however many legs it holds
  (the "1 ticket, not 5" rule lives in `settlement-engine/rules.ts`,
  unchanged).

### Weekly Report Agent (`weekly_report`)

`packages/agents/src/football/weekly-report-agent.ts`

- **Side-effect level:** `ANALYSIS`
- **Consumes:** caller-supplied, already-settled `Settlement[]`.
- **Produces:** `ticketCounts` (WON/LOST/VOID/PUSH/PENDING/CANCELLED)
  and `predictionWinRate` (computed over WON+LOST only — VOID/PUSH/
  PENDING/CANCELLED correctly excluded from the denominator, `null`
  rather than `0` with zero settled tickets).
- **`executedWagerPerformance` is always `undefined`** — a genuine,
  documented gap: `@sport-os/settlement-engine`'s types carry no stake/
  payout amount anywhere yet, so real monetary P&L/ROI/drawdown/losing-
  streak reporting is honestly impossible today. See
  `OPEN_QUESTIONS.md`. **PREDICTION PERFORMANCE ≠ EXECUTED WAGER
  PERFORMANCE** — never conflated, and the latter is never fabricated to
  fill the gap.

## Cross-domain

### Telegram Channel Management Agent (`telegram_channel_management`)

`packages/agents/src/telegram-channel-agent.ts`

- **Side-effect level:** `REQUESTED_ACTION`
- **Depends on:** `@sport-os/telegram`'s real `evaluatePublishingPolicy()`
  (never a second publication policy engine), `TelegramDestinationManager`,
  `TelegramService`.
- **Consumes ALREADY-FINALIZED content** — `finalizedText` is the exact,
  complete message body; this agent never templates, reformats, or
  recomputes any part of it. Structurally cannot change probabilities/
  selections/odds/stake/execution result: its input type has no such
  field to mutate.
- **Produces:** which destinations were published to (with the real
  Telegram message id, associating ticket → destination → message) and
  which were skipped, with the Publishing Policy Engine's own reason.

### Performance Agent (`performance`)

`packages/agents/src/performance-agent.ts`

- **Side-effect level:** `ANALYSIS`
- **Consumes:** caller-supplied, already-settled `DoubleBetRecord[]`
  (Aviator only, today).
- Unlike the Weekly Report Agent's football-side gap,
  `DoubleBetRecord` genuinely carries real `totalStake`/`totalReturn`/
  `netPnl`/`roi` once both legs settle — so this agent's Aviator P&L
  figures are real numbers, not placeholders, whenever settled records
  are supplied. Only settled bets (`totalReturn !== undefined`)
  contribute to the money math; still-open bets are counted but excluded,
  never treated as a zero outcome.
- Computes real `maxDrawdown`/`longestLosingStreak` over the settled P&L
  sequence, in the order the caller supplies (a chronological equity
  curve).

## Aviator agents

### Aviator Intelligence Agent (`aviator_intelligence`)

`packages/agents/src/aviator/intelligence-agent.ts`

- **Side-effect level:** `ANALYSIS`
- **Depends on:** `AviatorSignalEngine` (`@sport-os/aviator-engine`) —
  `NotImplementedAviatorSignalEngine` is the only implementation today.
- Signal states are the closed set Section 06 locks:
  `BUY`/`SELL`/`WAIT`/`NO_TRADE`/`MONITOR` (`AviatorSignalState`, added
  to `aviator-engine/signal-engine.ts` in Section 06 — Section 01 had no
  state at all). `signal: undefined` (no signal available) is distinct
  from a real `WAIT`/`NO_TRADE`/`MONITOR` state (a signal that says
  "don't trade right now" IS a signal).
- **Never:** executes anything, claims a guaranteed prediction,
  manufactures a historical observation.

### Aviator Risk Agent (`aviator_risk`)

`packages/agents/src/aviator/risk-agent.ts`

- **Side-effect level:** `ANALYSIS`
- **Depends on:** the SHARED `GlobalDailyRiskController` instance
  (`@sport-os/risk-engine`) — never its own. See
  [`../agents/AGENT_CORE.md`](../agents/AGENT_CORE.md)'s "Global Daily
  Risk Controller is not an agent."
- **Produces:** `executionAllowed` + `reason` (exactly mirroring
  `RiskControllerState` — `DAILY_TARGET_REACHED`/
  `DAILY_STOP_LOSS_REACHED` — never a paraphrase) + `cumulativePnL`.
- **Never:** records a result (`recordResult()` belongs to whichever
  code actually observes a settled outcome, not this eligibility check),
  creates a second ledger.

### Aviator Automation Agent (`aviator_automation`)

`packages/agents/src/aviator/automation-agent.ts`

- **Side-effect level:** `EXECUTION`
- **Depends on:** `ExecutionIntegration` (shared with the Football
  Automation Agent); requires `riskDecision: AviatorRiskDecision` as
  REQUIRED input — refuses immediately when `executionAllowed` is
  `false`, regardless of `executionMode`, before ever touching the
  integration.
- **The one place `@sport-os/aviator-engine`'s locked Double Bet model
  is actually used**: `buildDefaultDoubleBetLegs()` constructs the real
  `DoubleBetRecord` — exactly 50/50 unless the caller's own input
  explicitly overrides it (nothing in this codebase does), never a
  martingale progression. Each leg gets its own distinct idempotency key
  derived from the request's key.
- Same MANUAL/ASSISTED/AUTOMATIC semantics as the Football Automation
  Agent.

## What Section 06 does NOT own

Every agent above delegates its actual computation to an already-real
Section 01–05 service/engine, or to a typed boundary
(`DecisionEngine`/`ExecutionIntegration`/`SettlementService`) whose only
implementation today explicitly says "not implemented." None of the
following exist anywhere in `@sport-os/agents` or `@sport-os/agent-core`:

- Value Engine logic (expected-value/market-ranking math)
- Stake sizing
- Final risk authorization (beyond consulting the shared
  `GlobalDailyRiskController`/`GlobalExecutionGate`)
- Bookmaker execution (a real API call, CAPTCHA/anti-bot bypass, scraping)
- Settlement calculations (leg/ticket outcome determination)
- Telegram publishing implementation beyond the agent contract boundary
  (content generation, template rendering)
- Weekly report implementation beyond counting/rate-deriving over
  caller-supplied settled data
- Section 07 risk architecture, Section 08 settlement architecture,
  Section 09 UI, Section 10 Telegram infrastructure

See [`adversarial.test.ts`](../../packages/agents/src/adversarial.test.ts)
for the explicit, numbered test suite proving each of these boundaries
holds under adversarial pressure.
