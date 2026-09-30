# Ticket Engine (Section 07)

`packages/football-engine/src/ticket-engine.ts`. Produces a canonical,
immutable **ticket proposal** — distinct from a `ValueAssessment`
(`DecisionOutcome.BET` is an *input* here, never the ticket itself), and
distinct from `@sport-os/settlement-engine`'s `Ticket`/`Settlement`
(Section 08's post-execution/settlement concern). **"A ticket proposal is
NOT an executed wager."**

## SINGLE vs ACCUMULATOR (§12/§13)

```ts
deriveTicketType(legCount) // legCount <= 1 -> SINGLE, else -> ACCUMULATOR
```

A 5-leg accumulator is **one** `TicketRecord` with **five** `TicketLeg`
rows — `createTicketDraft()` always constructs exactly one
`TicketRecord`, however many legs it's given; nothing in this module ever
flattens legs into separate tickets, and nothing invents a stake at
construction time (`stake: undefined` until `authorizeTicketStake()`).

## `TicketLeg` — the only sanctioned way a leg enters a ticket

```ts
ticketLegFromValueAssessment(assessment: ValueAssessment, leakageFlag = false): TicketLeg
```

Throws `TICKET_LEG_MISSING_VALUE_DATA` if `calibratedProbability` or
`marketOdds` is `null` — **no other function in this module accepts a raw
probability/odds pair directly**, so every leg is traceable back to a
real `evaluateValue()` call (fixture, market, selection, probability,
odds, fair odds, EV, edge, model version, calculation version,
evaluation timestamp — all copied verbatim, never recomputed).
`leakageFlag` is set by the caller from whatever Section 04/05
`LeakageGuard` reported for the leg's underlying data — never computed
here, and never defaulted to "safe" by assumption.

## Accumulator combined odds and probability (§18)

```ts
computeCombinedOdds(legs)        // product of leg.odds
computeCombinedProbability(legs) // product of leg.probability, tagged
```

`computeCombinedProbability()` is **always** tagged
`method: "independence_assumption"` with a versioned
`calculationVersion` (`COMBINED_PROBABILITY_CALCULATION_VERSION`) —
"If P(A and B) ≈ P(A) × P(B) is used: explicitly mark the independence
assumption, version the calculation... never present an unsupported
accumulator probability as exact." No correlated/joint probability model
is implemented anywhere in this codebase; that would require a validated
correlation model this section doesn't have, so it isn't approximated.
`TicketRiskLegInput.correlationGroup` (`@sport-os/risk-engine`) is the
one structured extension point reserved for a future correlated-exposure
control — unused by any check today, present only so the *field* exists
for a later, validated implementation to consume.

## The ticket state machine (§14)

```
DRAFT → PROPOSED → VALIDATED → AUTHORIZED → EXECUTING → EXECUTED
  ↘        ↘           ↘
   CANCELLED  REJECTED    REJECTED / CANCELLED
```

Enforced by `ALLOWED_TICKET_TRANSITIONS` + `isValidTicketTransition()` —
the exact same lookup-table pattern already used for `AgentStatus`/
`InvocationStatus` (`agent-core`, Section 06). `EXECUTED`/`REJECTED`/
`CANCELLED` are terminal — no transition out of any of them exists.
Settlement states (`WON`/`LOST`/etc.) are **not** part of this enum —
that's Section 08's boundary; see below.

`transitionTicketStatus(ticket, next, now, patch?)` is the **only** way a
`TicketRecord`'s status ever changes. It throws
`TICKET_INVALID_TRANSITION` on any transition not in the table above, and
— critically — **never mutates its input**: it returns a brand-new object
with `version` incremented. "Historical ticket records never overwritten
— new versions/observations instead" holds by construction here, the
same way `transitionInvocationStatus`/`fixture_status_observations`
already do it elsewhere in this codebase. See
`packages/agents/src/section07-adversarial.test.ts`'s scenario 10 for the
adversarial proof (the original ticket object's fields are byte-identical
after a transition; the returned object is a different reference
entirely), and `tests/database/100_section07_rls_cases.sql`'s TESTs 34–35
for the same guarantee enforced at the database level
(`ticket_status_history`'s append-only `(ticket_id, version)` rows).

`authorizeTicketStake(ticket, stake, now)` is the **only** place a
`TicketRecord` ever gets a non-`undefined` stake — it throws
`TICKET_INVALID_STAKE` for `stake <= 0`, and is itself just
`transitionTicketStatus(ticket, AUTHORIZED, now, { stake })`, so it's
only reachable from `VALIDATED` (no path from `DRAFT` straight to a
staked ticket). "Do not invent stake" holds because nothing else in this
module ever sets it.

## Ticket validation (§19)

```ts
validateTicket(ticket: TicketRecord, constraints: TicketConstraints, decisions: readonly ValueAssessment[]): TicketValidationResult
```

Deterministic — the same ticket + constraints + decisions always produces
the same result — and collects **every** violated rule, not just the
first:

| `TicketValidationFailureCode` | Trigger |
|---|---|
| `NO_LEGS` | zero legs |
| `TOO_MANY_LEGS` | an `ACCUMULATOR` exceeding `constraints.maxAccumulatorLegs` |
| `DUPLICATE_LEG` | two legs share `(fixtureId, marketType, selection, line)` |
| `INVALID_PROBABILITY` | a leg's `probability` outside `(0, 1]` |
| `INVALID_ODDS` | a leg's `odds` not `> 1` or not finite |
| `LEAKAGE_FLAGGED` | a leg's `leakageFlag` is `true` |
| `MISSING_VALUE_CALCULATION` | a leg's `expectedValue`/`edge` is `null` |
| `DECISION_NOT_BET` | no matching `ValueAssessment` with `decision === BET` for the leg |

`DECISION_NOT_BET` is the enforcement point that stops a ticket ever
being built from anything other than a real `BET` decision — even a leg
constructed with otherwise-valid data fails validation if the caller
didn't also supply the matching `BET` `ValueAssessment`.

## Section 08 boundary — no settlement here

`TicketStatus` stops at `EXECUTED`. `WON`/`LOST`/`VOID`/`PUSH`/`PENDING`/
`CANCELLED` (`@sport-os/settlement-engine`'s `Ticket`/`Settlement`
status) are a **different type entirely**, owned by a different package,
and this module produces nothing that could be mistaken for one. No
partial-leg accumulator payout calculation exists here — that's a genuine
settlement computation, explicitly Section 08's job (see `OPEN_QUESTIONS.md`
#18).

## Section 10 boundary — no publication infrastructure here

Nothing in this module formats a ticket for Telegram, decides which
destination it goes to, or calls `@sport-os/telegram`. A `TicketRecord`
is a publication-ready *reference* (stable `ticketId`, real legs, real
combined odds/probability) that a later Section 10 publisher could read
— never itself a publishing call.

## See also

- [`DECISION_ARCHITECTURE.md`](./DECISION_ARCHITECTURE.md)
- [`VALUE_ENGINE.md`](./VALUE_ENGINE.md) — where a leg's underlying
  `ValueAssessment` comes from.
- [`RISK_EXECUTION.md`](./RISK_EXECUTION.md) — what happens to a
  `VALIDATED` ticket next.
- `packages/football-engine/src/ticket-engine.test.ts` — 22 tests,
  including a full `DRAFT → ... → EXECUTED` state-machine walk and every
  `validateTicket()` failure code.
