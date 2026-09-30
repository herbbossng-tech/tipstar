# Settlement Architecture (Section 08)

The settlement layer answers exactly one question per ticket: **what
actually happened, and — separately — what actually got paid.** It never
answers "was this a good bet" (that's `VALUE_ENGINE.md`) and never
decides whether to place a wager (that's `TICKET_ENGINE.md`/
`RISK_EXECUTION.md`). Settlement is pure grading + accounting over
already-final inputs.

## The eight distinct concepts (§1)

`Prediction → Decision → Ticket proposal → Authorized ticket → Execution
request → Confirmed execution → Settlement → Financial outcome`. Each of
these is a real, separately-typed thing in this codebase (see
`DECISION_ARCHITECTURE.md`, `TICKET_ENGINE.md`, `RISK_EXECUTION.md` for
the first six). Settlement and financial outcome are Section 08's own
two additions, and the rule that separates them is load-bearing
throughout this document:

> **A settlement is always computed. A financial outcome exists only
> when a real wager was executed.**

A ticket that was never staked can still be `WON` or `LOST` — that's an
**analytical** outcome, useful for measuring whether the decision logic
is any good. It is never a financial loss, because no money moved. See
`FINANCIAL_ACCOUNTING.md` for the full ANALYTICAL ≠ FINANCIAL treatment.

## Where the code lives

| Concern | Package | File |
|---|---|---|
| Sport-agnostic financial primitives (`Money`, `PayoutSource`, `LedgerMode`, `SettlementRevision`) | `@sport-os/settlement-engine` | `types.ts` |
| Currency-safe arithmetic, net P&L, ROI | `@sport-os/settlement-engine` | `financial.ts` |
| Settlement corrections (append-only revisions) | `@sport-os/settlement-engine` | `revisions.ts` |
| Football market grading + accumulator aggregation + ticket settlement | `@sport-os/football-engine` | `settlement.ts` |
| Aviator / Double Bet settlement | `@sport-os/aviator-engine` | `settlement.ts` |
| Orchestration (REQUEST → Settlement Engine → Result) | `@sport-os/agents` | `football/settlement-agent.ts` |
| Persistence | `supabase/migrations/2026093017{01,02}00_*.sql` | `settlements`, `settlement_legs`, `settlement_revisions` |

Every one of these is a pure function or a thin orchestration wrapper —
no settlement math lives in the agent, and no agent math lives in the
engine. "Extend the existing Football Settlement Agent to orchestrate
settlement. It must NOT duplicate settlement mathematics" (§38) holds by
construction: `SettlementAgent.execute()`'s Section 08 path is a single
call to `settleTicket()`.

## The settlement state machine (§5)

```
PENDING → WON / LOST / VOID / PUSH
PENDING → CANCELLED   (valid pre-settlement)
```

`SettlementStatus` (`@sport-os/settlement-engine/types.ts`) is exactly
these six values — no invented synonyms, no sport-specific extras. There
is **no ordinary mutation path** from `WON` to `LOST` or back: nothing in
this codebase ever updates a `settlements` row's `status` column (the
migration comment on `settlements` says so, and the table carries no
`UPDATE` grant for any role except `service_role`, which the application
layer itself never uses for that purpose). The only way an already-
settled outcome changes is an explicit `settlement_revisions` row — see
"Settlement corrections" below.

This state machine is intentionally **separate** from `TicketStatus`
(`DRAFT → ... → EXECUTED`, `TICKET_ENGINE.md`) and from
`ExecutionResultStatus` (Section 07). A ticket can be `EXECUTED` with
`execution_result = ACCEPTED` while its settlement is still `PENDING`,
and later become `WON` once a result exists — three independent states
tracked by three independent tables, never collapsed into one column.

## Settlement inputs (§7)

Every `TicketSettlement` (`football-engine/settlement.ts`) is built from:

- `ticket_id` + `ticket_version` — the exact `TicketRecord` graded, not
  "the current ticket" (a ticket's `version` increments on every
  transition; settling always names which version).
- `ticket.legs` — the real `TicketLeg` rows, never re-derived.
- `results: ReadonlyMap<UUID, FootballResultSnapshot>` — the real,
  point-in-time-resolved result per fixture, supplied by the caller from
  Section 04's `MatchResultsRepository.getAsOf()`/`getLatest()`. This
  module never queries a result itself — it only grades what it's given.
- `FootballResultSnapshot.resultVersionId` — threaded onto every
  `LegSettlement.resultVersionId`, so the exact `match_results` row
  version used is always recorded (`settlement_legs.result_version_id`,
  FK to `match_results.id`). **Settlement never queries "the latest
  result" without recording which version it used** (§7's own wording).
- `settlement_policy_version` — `FOOTBALL_SETTLEMENT_POLICY_VERSION`
  (`"football-settlement-v1"`), stamped on every settlement. A future
  change to the accumulator/market rules gets a new version string, never
  a silent behavior change under the same version.
- `settledAt`, `source`, `correlationId` — provenance, always present.

If a fixture has no entry in `results`, every leg on that fixture grades
`PENDING` ("No result is available yet for this fixture") — never
guessed.

## Market settlement (§10/§11)

`settleMarket(marketType, selection, line, result)`
(`football-engine/settlement.ts`) is a pure, deterministic switch over
`MarketType` — one grading function per market, each independently
testable:

| Market | Rule |
|---|---|
| 1X2 (`MATCH_RESULT_1X2`) | Compare `selection` to `threeWayOutcome(homeGoals, awayGoals)`. |
| Double Chance | `1X`→{HOME,DRAW}, `X2`→{DRAW,AWAY}, `12`→{HOME,AWAY}; WON if the actual 1X2 outcome is covered. |
| BTTS | WON iff `selection` matches whether both `homeGoals > 0 && awayGoals > 0`. |
| Over/Under | `total === line` → **PUSH** (stake returned); otherwise WON/LOST by `total` vs `line`. |
| Correct Score | Exact `"{home}-{away}"` string match. |
| European Handicap | Canonical **three-way**: `line` added to home goals, then graded like 1X2 — always resolves HOME/DRAW/AWAY, **never a push**. |
| Asian Handicap | Only whole/half lines (`isSupportedAsianLine`) — a quarter line (e.g. `-0.25`) is graded **PENDING**, not guessed, because it requires split-stake settlement this codebase doesn't implement. Margin `=== 0` → PUSH. |
| 1H (`FIRST_HALF`) | Grades `halftimeHomeGoals`/`halftimeAwayGoals` like 1X2; PENDING if halftime score isn't available. |
| 2H (`SECOND_HALF`) | Grades `(fulltime − halftime)` like 1X2; PENDING if halftime score isn't available (needed to derive second-half goals). |
| Team Totals / Corners / Cards | Always **PENDING** — `FootballResultSnapshot` carries no canonical data for them (§10: "if required result data is unavailable: PENDING. Do not guess."). |

`result: undefined` (no result known at all) always grades PENDING,
regardless of market.

## Accumulator settlement (§13/§14)

`settleTicketLegs(legSettlements)` is the single aggregation function —
**"a 5-leg accumulator is ONE TICKET, FIVE LEGS"** holds because
`settleTicket()` always constructs exactly one `TicketSettlement` however
many legs it grades.

**A genuine SINGLE (exactly one leg)** takes that leg's own status
directly — a single that pushes stays `PUSH`, never relabeled `VOID`.
This is deliberately distinct from the accumulator collapse rule below
(see Errors #2 in project history — the two were originally conflated,
caught by a failing test).

**A genuine multi-leg ACCUMULATOR** aggregates in this order:

1. Any `LOST` leg → ticket `LOST` (checked first — conclusive regardless
   of any other leg's status, including a still-`PENDING` one).
2. Otherwise any `PENDING` leg → ticket `PENDING`.
3. Otherwise, if **every** leg is `VOID`/`PUSH` → ticket `VOID` (§13's
   explicit, versioned policy — no leg won anything, so there's nothing
   to distinguish "push" from "void" at the ticket level; the whole stake
   is returned either way). This is a documented convention under
   `FOOTBALL_SETTLEMENT_POLICY_VERSION`, never a silently-applied
   bookmaker-specific rule.
4. Otherwise (every leg `WON`/`VOID`/`PUSH`, at least one real `WON`) →
   ticket `WON`. `VOID`/`PUSH` legs contribute a **neutral 1.0
   multiplier** to the combined odds — they neither help nor hurt the
   payout.

`TicketLegAggregation.combinedMultiplier` is the product of `WON` legs'
odds (VOID/PUSH contribute `1`) — `undefined` whenever the ticket didn't
resolve `WON` (nothing meaningful to multiply).

## Void/Push payout rule

- `WON` → payout = actual provider payout when available; otherwise a
  labeled `calculatedReturn` (stake × `combinedMultiplier`).
- `LOST` → payout = 0 (`calculatedReturn` is explicitly `{amount: 0,
  ...}`, never `null`, once the ticket is resolved and a stake exists).
- `VOID`/`PUSH`/`CANCELLED` → `calculatedReturn` = stake (the stake is
  returned, not a profit).

`CALCULATED_SETTLEMENT` vs `ACTUAL_EXECUTION_PAYOUT` (§12) is
`calculatedReturn` vs `actualPayout` — see `FINANCIAL_ACCOUNTING.md` for
the full split and why `netPnl`/`roi` only ever derive from the latter.

## Settlement corrections (§6/§9)

`createSettlementRevision()` / `resolveCurrentSettlement()`
(`settlement-engine/revisions.ts`) are the **only** sanctioned way a
settlement's effective outcome changes after the fact:

```ts
interface SettlementRevision {
  revisionId; originalSettlementId;
  previousStatus; newStatus;
  previousPayout; newPayout;      // Money | null
  reason; source;
  resultVersionId;                // the corrected result's version, when that's the cause
  createdAt; createdBy;
}
```

`settlement_revisions` is append-only (no `UPDATE`/`DELETE` grant
anywhere); `resolveCurrentSettlement(originalStatus, originalPayout,
revisions)` folds the chain — ordered by `createdAt` — into an
`EffectiveSettlement { status, payout, revisionCount, lastRevisedAt }`
**without discarding a single revision row**. Multiple genuinely
different corrections for the same original settlement are expected and
fully preserved (`tests/database/120_section08_rls_cases.sql` TEST 18
proves this at the database level).

Idempotent corrections: the caller supplies a deterministic
`idempotency_key` (e.g. `${originalSettlementId}:${resultVersionId}`),
enforced by a real partial unique index
(`settlement_revisions_idempotency_key_idx`, `where idempotency_key is
not null`) — "same result correction submitted twice" (§41 adversarial
#12) produces a unique-violation, never a duplicate financial effect.

## Idempotent settlement (§40)

`settlements.ticket_id, ticket_version, settlement_policy_version` is a
real database `UNIQUE` constraint (`settlements_ticket_id_ticket_
version_settlement_policy_vers_key`) — submitting the same ticket
version under the same policy version twice is rejected at the database
layer, not merely checked in application code. A **different**
`settlement_policy_version` for the same ticket is explicitly allowed
(proving the scoping is real, not overbroad — see
`tests/database/120_section08_rls_cases.sql` TEST 7).

## Settlement without execution, and execution without settlement (§45/§46)

- **Settled, never executed**: `settlement_status = LOST`,
  `execution = NOT_EXECUTED` (or simply no `FootballExecutionAccounting`
  supplied), `actualStake`/`actualPayout`/`netPnl`/`roi` all `null`. A
  fully valid, common state — it's how this codebase measures decision
  quality without ever claiming a financial loss.
- **Executed, not yet settled**: `execution_result = ACCEPTED`,
  `settlement_status = PENDING`. `actualStake` may be populated (a real
  stake was confirmed); `actualPayout`/`netPnl`/`roi` stay `null` until a
  result exists. Never marked WON/LOST until the market actually grades.

## Persistence (§43)

Six new tables, all append-only, all admin-only `SELECT` / `service_role`
-only write (`20260930170{0,1,2,3,4,5}00_*.sql`):

- `settlements` — one row per `TicketSettlement`.
- `settlement_legs` — one row per graded leg (FK to `ticket_legs` and to
  the exact `match_results` version used).
- `settlement_revisions` — append-only corrections.
- `performance_ledger` — see `PERFORMANCE_ARCHITECTURE.md`.
- `backtest_runs` / `backtest_results` — see `BACKTESTING_ARCHITECTURE.md`.

Every `Money` field is stored as an `(amount, currency)` pair with a
`CHECK` tying their nullability together (§44 — never a bare numeric
column that could silently drop currency). `settlements` additionally
`CHECK`s that `actual_payout_amount` is only ever populated alongside
`payout_source = 'PROVIDER'` — a `CALCULATED` figure can never masquerade
as an actual payout, enforced at the database level, not just in
TypeScript.

## Agent orchestration (§38)

`SettlementAgent` (`agents/football/settlement-agent.ts`) has two input
shapes:

- **Legacy** (`ticket`/`executedWager`/`officialResult`, Section 06,
  fields now optional) — delegates to the injected `SettlementService`,
  unchanged, still exercised by its own tests.
- **Real** (`richTicket`, Section 08) — calls `settleTicket()` directly;
  takes precedence when both are present. Returns both a narrow legacy
  `Settlement` view (for any caller still on the old contract) and the
  full `richSettlement: TicketSettlement` (per-leg detail, financial
  accounting) — directly consumable by `toPerformanceRecordInput()` /
  `buildPerformanceLedgerEntry()`, completing the documented
  "REQUEST → Settlement Engine → Settlement Result → Audit → Performance
  Ledger" flow. The agent computes no settlement math in either path.

## See also

- [`FINANCIAL_ACCOUNTING.md`](./FINANCIAL_ACCOUNTING.md) — actual vs
  calculated payout, net P&L, ROI, currency handling.
- [`PERFORMANCE_ARCHITECTURE.md`](./PERFORMANCE_ARCHITECTURE.md) — how
  settlements roll up into the performance ledger.
- [`BACKTESTING_ARCHITECTURE.md`](./BACKTESTING_ARCHITECTURE.md) — the
  same settlement engine reused, unmodified, for historical simulation.
- [`TICKET_ENGINE.md`](./TICKET_ENGINE.md) — where a `TicketRecord`
  (this module's input) comes from; its own "Section 08 boundary" section
  is now resolved by this document.
- `packages/football-engine/src/settlement.test.ts` — 43 tests.
- `packages/settlement-engine/src/{financial,performance,revisions}.test.ts`
  — 41 tests.
- `packages/agents/src/section08-adversarial.test.ts` — the 28 numbered
  adversarial scenarios.
- `tests/database/110_section08_fixtures.sql` /
  `120_section08_rls_cases.sql` — the real-Postgres RLS/constraint suite.
