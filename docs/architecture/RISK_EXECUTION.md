# Risk + Execution (Section 07)

Covers `@sport-os/risk-engine/ticket-risk-engine.ts`,
`@sport-os/platform/execution-gate.ts`'s real `GateCheck`s,
`@sport-os/agents/execution-integration.ts`'s extended contract, and the
`market_observations`/`value_evaluations`/`decisions`/`tickets`/
`ticket_legs`/`risk_evaluations`/`execution_requests`/`execution_results`
schema.

## Risk Engine (§17-19) — extends, never replaces, the Section 01 contract

`packages/risk-engine/src/service.ts`'s `RiskService`/`RiskAssessment`
(Section 01) are **unchanged**. `ticket-risk-engine.ts` is the real
implementation the spec asks for, additive alongside them:

```ts
evaluateTicketRisk(input: TicketRiskInput, limits: TicketRiskLimits, now): TicketRiskResult
evaluateAviatorDailyRisk(controller: GlobalDailyRiskController, now): TicketRiskResult
```

`TicketRiskResult extends RiskAssessment` (`approved`/`reason` unchanged)
and adds `riskCode`, `reasons` (every violated limit, not just the
first), `exposure`, `limitsSnapshot`, `evaluatedAt`, `policyVersion` —
full auditability of exactly what was checked and why.

`evaluateTicketRisk()` checks, all independently, collecting every
failure:

| `RiskCode` | Checked against |
|---|---|
| `MAX_STAKE_EXCEEDED` | `proposedStake > limits.maxStake` |
| `MAX_DAILY_EXPOSURE_EXCEEDED` | `dailyStakeSoFar + proposedStake > limits.maxDailyExposure` |
| `MAX_TICKETS_PER_DAY_EXCEEDED` | `dailyTicketCountSoFar + 1 > limits.maxTicketsPerDay` |
| `MAX_ACCUMULATOR_LEGS_EXCEEDED` | `legs.length > limits.maxAccumulatorLegs` |
| `LEAGUE_RESTRICTED` | any leg's `competitionId` in `limits.restrictedCompetitionIds` |
| `MARKET_RESTRICTED` | any leg's `marketType` in `limits.restrictedMarketTypes` |
| `DATA_QUALITY_BELOW_MINIMUM` | `worstDataQuality` not in `limits.minimumDataQuality` |
| `MODEL_AGREEMENT_BELOW_MINIMUM` | `modelAgreementRatio < limits.minimumModelAgreementRatio` (only when both are set) |

**Value and risk remain separate outputs.** `evaluateTicketRisk()` never
sees a probability, EV, or edge — `TicketRiskInput` has no such field.
`TicketRiskLegInput.correlationGroup` is a structured, currently-unused
extension point for a future correlated-exposure control (§37) — never a
sophisticated correlation model invented without a validated
implementation behind it.

### Aviator daily risk — reuses the ONE shared controller

`evaluateAviatorDailyRisk()` takes a `GlobalDailyRiskController` instance
**by reference** — it reads `getState()`/`isExecutionAllowed()`/
`getCumulativePnL()`, and never constructs its own controller (no `new
GlobalDailyRiskController(...)` anywhere in this file). Its `riskCode` is
one of `APPROVED`/`DAILY_TARGET_REACHED`/`DAILY_STOP_LOSS_REACHED` —
mirroring `RiskControllerState` exactly, never a paraphrase. This is the
same controller `@sport-os/agents`' Aviator Risk Agent already reads
(Section 06) — Section 07 adds a second, `RiskAssessment`-shaped way to
consult it, not a second ledger.

## Global Execution Gate — the first real `GateCheck`s (§J/§26)

`GlobalExecutionGate` itself, `GateCheck`, and `STANDARD_GATE_CHECK_ORDER`
(`identity → license → entitlement → risk → integration_availability`)
are unchanged from Section 01 — still the ONE gate in this codebase, and
still a fixed-order, short-circuiting pipeline over injected checks. What
Section 07 adds is the first **real** check implementations, in
`execution-gate.ts` itself:

| Check | Real implementation | Denial code(s) |
|---|---|---|
| `identity` | `createIdentityGateCheck(users)` — resolves `context.userId` via `UsersRepository.findById()`, requires an ACTIVE account | `IDENTITY_UNKNOWN`, `IDENTITY_INACTIVE` |
| `license` | `createLicenseGateCheck(licenseService)` — `LicenseService.getLicenseForUser()` + `isLicenseActive()` | `LICENSE_NOT_FOUND`, `LICENSE_INACTIVE` |
| `entitlement` | `createEntitlementGateCheck(licenseService, resolveRequiredEntitlement)` — `resolveRequiredEntitlement(context)` maps `(agentType, action)` to an `Entitlement`; `undefined` means "no entitlement required," never "deny by default" | `ENTITLEMENT_MISSING` |
| `risk` | `createRiskGateCheck()` — reads a **pre-computed** `{ riskApproved, riskCode?, riskReason? }` off `context.metadata.risk`; has no risk logic itself | `RISK_EVALUATION_MISSING`, or the caller's own `riskCode` |
| `integration_availability` | `createIntegrationAvailabilityGateCheck(integration)` — duck-typed against `{ isAvailable(): Promise<boolean> }` (never imports `@sport-os/agents`, which already depends on `platform` — the reverse dependency would be circular) | `INTEGRATION_NOT_AVAILABLE` |

`buildStandardGateChecks(deps)` assembles all five in exactly
`STANDARD_GATE_CHECK_ORDER`'s order — the one place a caller should build
a production `GlobalExecutionGate` from, rather than hand-assembling the
list. **The "risk" check never calls the Risk Engine itself** — by
design, this keeps `platform` decoupled from `risk-engine` (no new
cross-package dependency), and keeps value/risk/execution-authorization
as three genuinely separate steps: a caller runs `evaluateTicketRisk()`
(or `evaluateAviatorDailyRisk()`) first, then passes its result into
`context.metadata.risk` before calling `gate.authorize()`.

No agent may call an execution adapter directly — enforced structurally
by `AgentOrchestrator.dispatch()` (Section 06, unchanged), which refuses
to run an `EXECUTION`/`REQUESTED_ACTION`-level agent without a passing
`ExecutionAuthorizer.authorize()` call first.

## Execution Request / Result contract (§K/§29)

`@sport-os/agents/execution-integration.ts`, extended additively:

```ts
interface ExecutionIntegrationRequest {
  ticketOrSignalId: string; stake: number; idempotencyKey: string; // unchanged (Section 06)
  marketType?: string; selection?: string; odds?: number; requestedAt?: ISODateString; // Section 07 additions
}

interface ExecutionIntegrationResult {
  externalReference: string; stake: number; executedAt: ISODateString; // unchanged
  status: ExecutionResultStatus; // Section 07 addition — every result now carries an explicit status
}

const ExecutionResultStatus = {
  REQUESTED, AUTHORIZED, SUBMITTED, ACCEPTED, EXECUTED,
  REJECTED, FAILED, UNKNOWN, NOT_AVAILABLE, MANUAL_REQUIRED,
} as const;
```

**Only a confirmed external result may ever be `EXECUTED`.** Nothing in
this codebase manufactures that state — the only `ExecutionIntegration`
implementation, `NotImplementedExecutionIntegration`, never produces one:
`isAvailable()` is always `false`; `validate()` returns an explicit
`{ valid: false, status: NOT_AVAILABLE }` (a pre-flight query, never a
throw — a caller is expected to check it before attempting `execute()`);
`execute()`/`status()` throw `NotImplementedError` rather than fabricate
a result.

```ts
interface ExecutionIntegration {
  isAvailable(): Promise<boolean>;
  validate(request): Promise<ExecutionValidationResult>;
  execute(request): Promise<ExecutionIntegrationResult>;
  status(externalReference: string): Promise<ExecutionResultStatus>;
}
```

`validate`/`execute`/`status` is the execution adapter boundary — a
pre-flight check, the attempt itself, and a later poll of a submitted
request's outcome, matching the same three-step shape a real bookmaker
integration would need.

## Manual / Assisted / Automatic execution modes

Unchanged from Section 06 (`FootballExecutionMode`/`AviatorExecutionMode`
— both `manual`/`assisted`/`automatic`): `MANUAL` always resolves to
`MANUAL_REQUIRED` without ever touching the integration; `ASSISTED`
requires `userConfirmed: true` — an explicit flag the caller must have
obtained from a genuine user action, never inferred from merely opening a
screen or viewing a proposal (§24); `AUTOMATIC` still requires the
orchestrator's `GlobalExecutionGate` pass. Human confirmation is
auditable at the point the caller sets `userConfirmed`, not re-derived
here.

## Execution idempotency (§N)

Enforced at **two independent layers**, both real:

1. **`AgentOrchestrator`'s idempotency store** (`agent-core`, Section 06,
   unchanged) — a repeated `idempotencyKey` for the same command replays
   the original invocation's result rather than re-running the agent (and
   therefore never re-calling `ExecutionIntegration.execute()`).
2. **A real database `UNIQUE` constraint** on
   `execution_requests.idempotency_key` (Section 07) — enforced by
   Postgres itself, not application logic; proven against a real
   Postgres instance in `tests/database/100_section07_rls_cases.sql`
   TESTs 16–17, including that the uniqueness is **global**, not scoped
   per-ticket (a retried key collides even across a different
   `ticket_or_signal_id`).

`packages/agents/src/section07-adversarial.test.ts`'s scenario 5 is the
TypeScript-level twin of layer 1; the database tests are the twin of
layer 2.

## Database schema

10 new migrations
(`supabase/migrations/20260929160000_execution_enums.sql` through
`20260929160900_execution_rls_policies.sql`):

| Table | Shape | Immutability |
|---|---|---|
| `market_observations` | `MarketObservation` snapshots | Append-only — a new observation is a new row, never an `UPDATE` |
| `value_evaluations` | `ValueAssessment` output (Value Engine's own judgment only — no risk column at all) | Append-only |
| `tickets` | Mutable "current state" (mirrors `fixtures`) | — |
| `ticket_status_history` | One row per version, `UNIQUE(ticket_id, version)` (mirrors `fixture_status_observations`) | Append-only |
| `ticket_legs` | One row per leg, fixed for the ticket's lifetime | Insert-only |
| `risk_evaluations` | `TicketRiskResult` output — ticket-level (`ticket_id` set) or Aviator daily (`ticket_id` null) | Append-only |
| `decisions` | A `value_evaluations` row optionally combined with one `risk_evaluations` row via `applyRiskRejection()` | Append-only |
| `execution_requests` | The attempted-execution audit record, whatever the gate outcome; real `UNIQUE(idempotency_key)` | Append-only |
| `execution_results` | Status history per request; only a real adapter call ever inserts `EXECUTED` | Append-only |

Every table: `alter table ... enable row level security`, admin-only
`SELECT` (`is_admin()`), **no** `INSERT`/`UPDATE`/`DELETE` policy for
`anon`/`authenticated` at all — writes happen only through a
`service_role`-backed repository (a later implementation task), matching
Section 06's `agent_invocations`/`agent_messages` pattern exactly. No
table here has broad `authenticated` write access, and no existing RLS
policy from any prior section was weakened.

**Historical records are never overwritten.** `tickets`/`ticket_legs`
have real `NOT NULL`/`CHECK` constraints (positive stake, probability in
`(0,1]`, odds `> 1`) enforced at the database level — proven in
`tests/database/100_section07_rls_cases.sql` (36 tests total: RLS access
per table, service-role write paths, both idempotency constraints, every
`CHECK` constraint, and `ticket_status_history`'s append-only versioning).
See that file and `tests/database/README.md` for the full transcript
convention.

## See also

- [`DECISION_ARCHITECTURE.md`](./DECISION_ARCHITECTURE.md)
- [`VALUE_ENGINE.md`](./VALUE_ENGINE.md)
- [`TICKET_ENGINE.md`](./TICKET_ENGINE.md)
- `packages/risk-engine/src/ticket-risk-engine.test.ts` — 17 tests.
- `packages/platform/src/execution-gate.test.ts` — 23 tests (5 original
  Section 01 pipeline tests + 18 new `GateCheck`/`buildStandardGateChecks`
  tests).
- `packages/agents/src/section07-adversarial.test.ts` — the 14 numbered
  adversarial scenarios, several of which (3, 4, 5, 7, 8, 12, 13) are
  specific to this document.
