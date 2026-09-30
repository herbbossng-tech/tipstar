# Decision Architecture (Section 07)

The full pipeline Section 07 makes real, and the one rule every piece of
it enforces by construction:

```
PROBABILITY → MARKET → VALUE → DECISION → TICKET → RISK
  → EXECUTION AUTHORIZATION → EXECUTION
```

**Probability is not a decision. Confidence is not value. Value is not
risk authorization. A ticket proposal is not an executed wager. Execution
authorization is not execution itself.** No function in this section
collapses two of these layers into one call — each layer is a distinct,
real module (or a distinct field on a shared record), and the only way
from one to the next is through the specific, typed transition function
documented below. See [`VALUE_ENGINE.md`](./VALUE_ENGINE.md),
[`TICKET_ENGINE.md`](./TICKET_ENGINE.md), and
[`RISK_EXECUTION.md`](./RISK_EXECUTION.md) for each layer's own detail;
this document is the map connecting them.

## Where each layer actually lives

| Layer | Function / type | Package |
|---|---|---|
| PROBABILITY | `MonteCarloResult` (unchanged, Section 05) | `@sport-os/football-engine` |
| MARKET | `mapProbabilityToMarket()` / `mapAllSupportedMarkets()` | `@sport-os/football-engine/market-mapping.ts` |
| (odds validity) | `checkOddsValidity()`, `MarketObservation` | `@sport-os/market-engine/types.ts` |
| VALUE | `evaluateValue()` | `@sport-os/football-engine/decision.ts` |
| DECISION | `ValueAssessment.decision` (Value Engine's own judgment) | `@sport-os/football-engine/decision.ts` |
| (risk, applied to a decision) | `applyRiskRejection()` | `@sport-os/football-engine/decision.ts` |
| TICKET | `createTicketDraft()` / `transitionTicketStatus()` / `validateTicket()` | `@sport-os/football-engine/ticket-engine.ts` |
| RISK (ticket-level) | `evaluateTicketRisk()` | `@sport-os/risk-engine/ticket-risk-engine.ts` |
| RISK (Aviator daily) | `evaluateAviatorDailyRisk()` | `@sport-os/risk-engine/ticket-risk-engine.ts` |
| EXECUTION AUTHORIZATION | `GlobalExecutionGate.authorize()` + `buildStandardGateChecks()` | `@sport-os/platform/execution-gate.ts` |
| EXECUTION | `ExecutionIntegration.validate()/execute()/status()` | `@sport-os/agents/execution-integration.ts` |

Every one of these is a **real, tested implementation** — not a
`NotImplemented*` placeholder — except `ExecutionIntegration` itself,
which has exactly one implementation
(`NotImplementedExecutionIntegration`) because no authorized bookmaker
integration exists (see "What Section 07 does NOT implement" below).

## Why the layers can't collapse

Each transition between layers is a **separate function that only reads
the previous layer's output — it never recomputes it**:

- `evaluateValue()` calls `mapProbabilityToMarket()` and
  `checkOddsValidity()` — it never invents a probability or an odds
  figure itself; both come from already-real Section 05 output and a
  real `MarketObservation` row.
- `applyRiskRejection(assessment, riskApproved, riskReason?)` is a **pure
  function taking an already-computed `ValueAssessment` and an
  already-computed risk boolean** — it cannot itself call the Risk
  Engine, and the Risk Engine (`evaluateTicketRisk()`) cannot itself see
  a probability, EV, or edge (its input type, `TicketRiskInput`, has no
  such field). Value and risk are computed independently and combined
  exactly once, here.
- `ticketLegFromValueAssessment()` is the **only** way a `TicketLeg`
  enters a ticket — it throws if the `ValueAssessment` it's given has a
  null probability/odds, so a leg can never exist without a real,
  traceable value computation behind it (`TICKET_LEG_MISSING_VALUE_DATA`).
- `GlobalExecutionGate.authorize()` never touches a ticket, a stake, or
  an odds figure at all — its `ExecutionRequestContext` carries only
  `userId`/`agentType`/`action`/`metadata`. The "risk" `GateCheck`
  (`createRiskGateCheck()`) reads a **pre-computed** risk result off
  `context.metadata.risk` — it has no risk-evaluation logic of its own,
  and denies outright (`RISK_EVALUATION_MISSING`) if the caller didn't
  supply one. See [`RISK_EXECUTION.md`](./RISK_EXECUTION.md).
- `ExecutionIntegration.execute()` is called only after
  `GlobalExecutionGate.authorize()` returns `{ authorized: true }` —
  enforced structurally by `AgentOrchestrator.dispatch()`, which refuses
  to invoke an `EXECUTION`/`REQUESTED_ACTION`-level agent at all without
  a passing `ExecutionAuthorizer.authorize()` call first (see
  `packages/agent-core/src/orchestrator.ts`). No agent in
  `@sport-os/agents` calls an execution adapter directly.

## Structured decision reasons — never vague

Every non-`BET` outcome carries at least one `DecisionReasonCode` — a
closed set (`decision.ts`'s `DecisionReasonCode`), never a free-text
explanation invented per call site:

```
EDGE_BELOW_THRESHOLD, EV_BELOW_THRESHOLD, ODDS_STALE, ODDS_MISSING,
ODDS_INVALID, MARKET_SUSPENDED, MARKET_CANCELLED, DATA_QUALITY_LOW,
MODEL_DISAGREEMENT, MARKET_UNSUPPORTED, INSUFFICIENT_HISTORY,
PREDICTION_UNAVAILABLE, RISK_LIMIT, DAILY_STOP_LOSS,
DAILY_TARGET_REACHED, EXECUTION_UNAVAILABLE
```

`evaluateValue()` can attach several at once (e.g. a call that's both
`DATA_QUALITY_LOW` and `EDGE_BELOW_THRESHOLD` reports both, though a hard
block — data quality or model disagreement — always wins the *decision*
even when other reasons are also present). `DecisionOutcome` is the
equally closed set of terminal outcomes:

```
BET, NO_EDGE, WAIT, NO_TRADE, INSUFFICIENT_DATA, MARKET_UNSUPPORTED,
RISK_REJECTED
```

`BET` is the **only** outcome a ticket leg may legally be built from
(`ticketLegFromValueAssessment` doesn't enforce this itself, but
`validateTicket()` does — see `TicketValidationFailureCode.
DECISION_NOT_BET` in [`TICKET_ENGINE.md`](./TICKET_ENGINE.md)).

## What Section 07 does NOT implement

Per the spec's explicit boundary:

- **No real bookmaker/exchange integration.** `ExecutionIntegration`
  (`@sport-os/agents/execution-integration.ts`) has exactly one
  implementation, `NotImplementedExecutionIntegration`:
  `isAvailable()` always `false`, `validate()` always returns
  `{ valid: false, status: NOT_AVAILABLE }`, `execute()`/`status()`
  always throw. Every execution request this codebase can currently
  produce terminates at `NOT_AVAILABLE`/`MANUAL_REQUIRED` — never a
  fabricated `EXECUTED` result.
- **No Telegram publishing implementation** — Section 10's job; Section
  07 only produces ticket data a publisher could later reference.
- **No settlement implementation** — Section 08's job; `TicketStatus`
  stops at `EXECUTED`/`REJECTED`/`CANCELLED`, never `WON`/`LOST`. See
  [`TICKET_ENGINE.md`](./TICKET_ENGINE.md)'s "Section 08 boundary".
- **No weekly reporting** — unchanged from Section 06 (`@sport-os/agents`'
  Weekly Report Agent already covers what's possible without real
  settlement data).
- **No Mini App UI** — the tables and services this section built have no
  frontend consumer yet.
- **No new agent framework or licensing system** — `AgentOrchestrator`,
  `GlobalExecutionGate`'s pipeline shape, and `LicenseService`/
  `Entitlement` are unchanged from Sections 01/03/06; Section 07 only
  supplies the first **real** `GateCheck` implementations for
  `identity`/`license`/`entitlement`/`risk`/`integration_availability` —
  see [`RISK_EXECUTION.md`](./RISK_EXECUTION.md).

## See also

- [`VALUE_ENGINE.md`](./VALUE_ENGINE.md) — Market Engine integration,
  fair odds, edge, EV, the Value Engine, structured reasons.
- [`TICKET_ENGINE.md`](./TICKET_ENGINE.md) — Ticket Engine, SINGLE vs
  ACCUMULATOR, validation, immutable versioning.
- [`RISK_EXECUTION.md`](./RISK_EXECUTION.md) — Risk Engine, Global Daily
  Risk Controller, `GlobalExecutionGate`'s real checks, the Execution
  Request/Result contracts, idempotency.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md)'s "Section 07 boundaries".
- [`MODULE_BOUNDARIES.md`](./MODULE_BOUNDARIES.md) for where every
  boundary above physically lives.
- [`../../packages/agents/src/section07-adversarial.test.ts`](../../packages/agents/src/section07-adversarial.test.ts)
  for the 14 numbered adversarial scenarios proving these boundaries hold
  under pressure.
