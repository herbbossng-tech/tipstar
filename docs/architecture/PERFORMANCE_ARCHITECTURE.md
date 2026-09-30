# Performance Architecture (Section 08)

Performance reporting consumes already-settled records — it never
recomputes a settlement, never rewrites a historical outcome, and never
fabricates a missing financial value. Every figure here is either a real
sum over real `Money` values or an explicit `null`/`undefined` — never a
manufactured zero.

## One aggregator, two adapters

```
football-engine/settlement.ts   toPerformanceRecordInput(TicketSettlement)       ─┐
aviator-engine/settlement.ts    toPerformanceRecordInput(DoubleBetSettlement)     ├─▶ PerformanceRecordInput ─▶ buildPerformanceLedgerEntry() ─▶ PerformanceLedgerEntry
football-engine/backtest.ts     backtestToPerformanceRecordInput(...)            ─┘
```

`buildPerformanceLedgerEntry()` (`@sport-os/settlement-engine/
performance.ts`) is the **only** aggregation algorithm in this codebase.
It lives in `settlement-engine` — dependency-free besides `@sport-os/
shared` — precisely so it can be sport-agnostic: football, Aviator, and
backtest simulations each supply a thin, structural adapter
(`PerformanceRecordInput`) rather than a parallel aggregation
implementation. `PerformanceAgent` (`agents/performance-agent.ts`) no
longer keeps its own private `computeMaxDrawdown`/
`computeLongestLosingStreak` — both were moved into `settlement-engine`
in Section 08 so every consumer shares exactly one implementation.

```ts
interface PerformanceRecordInput {
  status: SettlementStatus;
  ledgerMode: LedgerMode;
  legCount: number;        // 1 for a single/Double Bet; >1 for an accumulator
  executed: boolean;
  actualStake: Money | null;
  actualPayout: Money | null;
  expectedEv: number | undefined;
  settledAt: ISODateString | null;
}
```

## What `buildPerformanceLedgerEntry` does

1. **Filters** `records` to `params.ledgerMode` first — the hard PAPER/
   LIVE boundary (see `FINANCIAL_ACCOUNTING.md`'s "Paper vs. live").
2. **Sums** `actualStake`/`actualPayout` only over records where **both**
   are known (`record.actualStake !== null && record.actualPayout !==
   null`) — a record with a known stake but an unknown payout never
   contributes a misleadingly-partial total to either side.
3. **Derives** `actualPnl`/`roi` from those sums via the same
   `computeNetPnl`/`computeRoi` every settlement uses.
4. **Builds the equity curve** from exactly one net-P&L number per
   settled-with-actuals record, ordered by `settledAt` — never per leg
   (§24/§27's "one losing accumulator is one losing ticket, not N leg
   losses").
5. **Averages** `expectedEv` only over records where it was actually
   supplied (`filter((v): v is number => v !== undefined)`) — a mix of
   known/unknown EV never silently treats the unknowns as zero.
6. Counts `ticketCount`/`legCount`/`executedTicketCount`/
   `settledTicketCount`/`wins`/`losses`/`voids`/`pushes`/`pending` over
   the full filtered set, and reports `sampleSize: records.length`
   unconditionally (§37).

## Ticket counting (§24)

`PerformanceRecordInput.legCount` carries the leg count **for reporting
only** — `ticketCount` is always `records.length` (one entry per ticket,
regardless of how many legs it has). A 5-leg accumulator that loses
contributes `ticketCount: +1, losses: +1, legCount: +5` — never `losses:
+5`. This is why `toPerformanceRecordInput()` on both the football and
Aviator sides sets `legCount` to the real leg count (`settlement.legs.
length`, or `1` for a Double Bet) but the aggregator itself only ever
increments per-ticket counters by iterating `records`, not by iterating
legs.

## `PerformanceLedgerEntry` — the reportable shape

```ts
interface PerformanceLedgerEntry {
  periodStart; periodEnd; ledgerMode; sport;
  league?; market?; modelVersion?; decisionPolicyVersion?; ticketType?;  // §29 breakdown dimensions — undefined means "not broken out here," never "unknown"
  ticketCount; legCount; executedTicketCount; settledTicketCount;
  wins; losses; voids; pushes; pending;
  actualStake; actualPayout; actualPnl; roi;   // Money | null / number | null
  expectedEv;                                   // number | null
  maxDrawdown; longestLosingStreak;             // number | null
  sampleSize;                                   // always present (§37)
}
```

Persisted 1:1 into `performance_ledger` (`supabase/migrations/
20260930170300_performance_ledger.sql`) — a recomputable cache/snapshot
of a rollup, never the system of record for the underlying settlements
(those remain `settlements`/`settlement_legs`). A `(period_start,
period_end, ledger_mode, sport, league, market, model_version,
decision_policy_version, ticket_type)` unique index is a defense-in-depth
guard for the common fully-dimensioned case; the table comment is honest
that Postgres treats each `NULL` as distinct, so it does not by itself
prevent duplicate rows when optional dimensions are left null —
recomputing and replacing a row for the same dimension tuple is an
application-layer upsert responsibility.

## Metrics never computed with a zero/undefined denominator (§37)

- `roi` is `null` unless `actualStake.amount > 0` (`computeRoi`).
- `expectedEv` is `null`, not `0`, when zero records supplied a value.
- `maxDrawdown`/`longestLosingStreak` are `null`, not `0`, for an empty
  P&L sequence — a real "0" (no drawdown observed across a real,
  non-empty sample) and "no data" are different, typed states.
- `sampleSize` is always the true denominator — the honest count of
  records considered, present on every entry (never presented as
  statistically strong when tiny — the number itself is always visible
  for the caller to judge).

## Max drawdown (§26)

```ts
function computeMaxDrawdown(realizedPnls: readonly number[]): number | null
```

Exactly the documented equity-curve definition: `equity_t = cumulative
realized P&L`, `peak_t = max(previous equity)`, `drawdown_t = peak_t -
equity_t`, `max_drawdown = max(drawdown_t)`. Only ever fed a sequence of
**realized** net-P&L numbers (one per settled-with-actuals ticket,
chronological by `settledAt`) — an unsettled or unexecuted ticket
contributes nothing to the curve, because it was excluded from
`settledWithActuals` before the sequence was built. Live and paper
drawdown are computed identically but never mixed — the `ledgerMode`
filter upstream keeps them in separate `PerformanceLedgerEntry` rows.

## Longest losing streak (§27)

```ts
function computeLongestLosingStreak(realizedPnls: readonly number[]): number | null
```

Longest consecutive run of `pnl < 0` in the supplied chronological order.
Because the sequence is built from one number per **ticket** (never per
leg, per the ticket-counting rule above), a losing 5-leg accumulator
contributes exactly one entry to the streak — never five. A `pnl === 0`
entry (a PUSH/VOID resolving to exact break-even) resets the streak
counter to `0` rather than extending it — it is neither a win nor a
loss.

## Closing-Line Value (§28)

```ts
interface ClosingLineValueInput { decisionOdds: number; closingOdds: number; }
function computeClosingLineValue(input): number | undefined   // (decisionOdds / closingOdds) - 1
```

`undefined` — never fabricated — whenever either odds figure is missing
or invalid (`<= 1` or non-finite); there is no "estimated closing line"
anywhere in this codebase. CLV is deliberately unaware of any realized
outcome: it is computed purely from two odds figures, kept entirely
separate from `netPnl`/`roi`. **A ticket can have positive CLV and still
lose** — nothing in this codebase collapses the two into one score.

## Performance breakdowns (§29)

`PerformanceLedgerEntry`'s `league`/`market`/`modelVersion`/
`decisionPolicyVersion`/`ticketType` dimensions, plus the caller-supplied
`sport` and `LedgerMode`, are the supported breakdown axes — one
`buildPerformanceLedgerEntry()` call per dimension combination the caller
wants reported, each producing its own row. **No confidence-bucket
breakdown exists**, because Section 05 defines no confidence metric
distinct from calibrated probability to bucket by — inventing one here
would violate "only create confidence buckets if Section 05 has a
defined confidence metric" (§30). Odds-bucket and EV/edge-bucket
breakdowns are supported the same way any other dimension is: the caller
pre-filters `records` to the desired bucket before calling in, since the
bucket boundaries themselves are a reporting-policy choice this engine
doesn't hard-code.

## Model lineage (§29/§34)

`PerformanceLedgerEntry.modelVersion`/`.decisionPolicyVersion` trace a
performance row back to the exact intelligence artifacts that produced
its underlying decisions — the same `modelVersion`/`policyVersion`
strings Section 05's `intelligence_model_versions`/
`intelligence_training_runs`/`intelligence_evaluation_runs` and Section
07's `ValueAssessment.modelVersion`/`DecisionPolicy` already carry.
Nothing here duplicates that lineage data — a performance row only ever
*references* the version string, never re-stores dataset/feature/
calibration/ensemble metadata that already lives in Section 05's tables.

## Agent integration (§39)

`PerformanceAgent.execute()` (`agents/performance-agent.ts`) accepts
`footballSettlements`/`doubleBetSettlements` (already-settled records)
and an optional `ledgerMode` (default `LIVE`), and returns
`footballLedger`/`aviatorLedger: PerformanceLedgerEntry | undefined` —
`undefined`, never a fabricated empty entry, whenever the caller supplied
no settlements for that sport. The agent's pre-existing Aviator-only
summary logic (`AviatorPerformanceSummary`, Section 06) is untouched;
Section 08 only adds the cross-sport ledger entries alongside it. The
agent alters no settlement outcome and fabricates no financial value —
every number it returns traces back to a real `TicketSettlement`/
`DoubleBetSettlement` the caller supplied.

## Sample size discipline (§37)

Every `PerformanceLedgerEntry` exposes `sampleSize` unconditionally.
Nothing in this codebase's reporting layer claims statistical
significance from a small sample — the number itself is always present
for a caller (or, eventually, a Section 11 report) to weigh
appropriately; no threshold is silently applied to hide or inflate a
tiny sample's apparent strength.

## See also

- [`FINANCIAL_ACCOUNTING.md`](./FINANCIAL_ACCOUNTING.md) — the
  underlying `Money`/net-P&L/ROI primitives this document aggregates.
- [`SETTLEMENT_ARCHITECTURE.md`](./SETTLEMENT_ARCHITECTURE.md) — where
  each individual settled record comes from.
- [`BACKTESTING_ARCHITECTURE.md`](./BACKTESTING_ARCHITECTURE.md) — the
  same aggregator, reused for PAPER backtest performance.
- `packages/settlement-engine/src/performance.test.ts` — 20 tests.
- `packages/agents/src/performance-agent.test.ts` — 7 tests.
