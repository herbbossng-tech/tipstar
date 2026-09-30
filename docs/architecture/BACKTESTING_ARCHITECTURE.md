# Backtesting Architecture (Section 08)

Backtesting answers "how would this decision policy have actually
performed" by re-running the **real** live decision and settlement
pipeline against historical data — never a second, parallel
implementation of either. This document covers only what Section 08
added; Section 05's walk-forward evaluation infrastructure (feature
computation, model training, chronological splitting, leakage
protection) is unchanged and reused as-is — see
`FOOTBALL_INTELLIGENCE.md` and `LEAKAGE_PROTECTION.md`.

## What Section 08 did NOT rebuild (§31)

- Walk-forward window generation / chronological splitting —
  `validation/walk-forward.ts`'s `generateWalkForwardWindows`/
  `splitExamplesByWindow`.
- Model training or prediction — `models/*.ts`.
- Feature computation — `features/*.ts`, `feature-store.ts`.
- Training dataset construction — `dataset/builder.ts`.
- Predictive-quality metrics — `evaluation/metrics.ts`'s `accuracy1x2`/
  `logLoss1x2`/`brierScore1x2` (reused directly, not reimplemented).
- Calibration, baselines, ensemble weighting.

"Reuse Section 05's existing walk-forward evaluation architecture — do
NOT create a second incompatible backtesting framework" (§31) holds
because `packages/football-engine/src/backtest.ts` imports and calls
these directly; it adds nothing to any of them.

## What Section 08 added

The layer Section 05 explicitly excluded: "Do not use ROI or realized
betting profit as the primary intelligence metric... belongs to the
later performance/backtesting layer" (Section 05's own documented scope
trim). `backtest.ts`'s job is exactly one thing: given a real model
prediction and a real historical odds/result pair, run it through the
**same** decision → ticket → settlement pipeline a live trade would use,
and report the simulated financial outcome.

## The pipeline, reused verbatim

```
BacktestDecisionPoint
  → evaluateValue()                    (Section 07, decision.ts — REAL, unmodified)
  → ticketLegFromValueAssessment()     (Section 07, ticket-engine.ts — REAL)
  → createTicketDraft()                (Section 07, ticket-engine.ts — REAL)
  → gradeAgainstTrainingExample()      (Section 08, NEW — grades against the example's own real label)
  → settleTicketLegs()                 (Section 08, settlement.ts — REAL, same function live decisions use)
  → BacktestSettlement (always LedgerMode.PAPER)
```

`simulateBacktestDecision(point, params)` is `async` and genuinely
`await`s `evaluateValue()` — every step from prediction through
settlement is the real production code path, never a simulated stand-in.
The **only** new logic in this whole flow is `gradeAgainstTrainingExample`,
because a backtest's "result" is a `TrainingExample`'s pre-existing
historical label, not a live `FootballResultSnapshot` row — everything
downstream of grading (`settleTicketLegs`, the calculated-return/net-P&L/
ROI arithmetic) is identical to `football-engine/settlement.ts`'s own
logic, intentionally duplicated in shape (not in package — `backtest.ts`
cannot import `football-engine/settlement.ts`'s private
`buildTicketSettlement`, so the same small computation is repeated
inline) but never diverging in behavior.

## Market scope — honest, not invented

```ts
marketType: typeof MarketType.MATCH_RESULT_1X2
          | typeof MarketType.OVER_UNDER
          | typeof MarketType.BOTH_TEAMS_TO_SCORE
```

`BacktestDecisionPoint.marketType` is scoped to exactly these three
markets **at the TypeScript type level**, not just a runtime check —
because `TrainingExample` (Section 05's dataset builder) only carries
`target1x2`/`targetTotalGoals`/`targetBtts` labels. There is no historical
label for Correct Score, Asian Handicap, Double Chance, etc. in this
codebase's dataset, so backtesting them would require guessing — refused
by construction rather than attempted. This mirrors Section 05's own
documented scope trim ("prioritize 1X2, total goals, BTTS").

## Leakage protection Section 08 adds (§32)

```ts
if (new Date(point.oddsTimestamp).getTime() > new Date(point.example.snapshotTime).getTime()) {
  throw new ValidationError({ code: "BACKTEST_FUTURE_ODDS", ... });
}
```

"A backtest may use only odds that were actually available at the
simulated decision time... do not use closing odds as decision-time
odds unless the strategy explicitly defines a closing-line strategy."
`simulateBacktestDecision` enforces this as a hard failure, not a
warning: any `BacktestDecisionPoint` whose `oddsTimestamp` is after its
`example.snapshotTime` throws before evaluation ever runs. This is
Section 08's own, concrete, directly-testable contribution to leakage
protection — layered on top of, never a replacement for, Section 05's
already-real feature/walk-forward leakage guards (`LeakageGuard`,
`generateWalkForwardWindows`'s chronological-only expansion).

`closingOdds` is a separate, optional field used **only** for computing
Closing-Line Value after the fact — never fed into the decision or
settlement itself. When absent, `closingLineValue` is correctly
`undefined`, never fabricated.

## Backtest settlement is always PAPER (§33)

`BacktestSettlement.ledgerMode: typeof LedgerMode.PAPER` is a literal
type — there is no code path by which `simulateBacktestDecision` can
produce a LIVE settlement. Combined with `buildPerformanceLedgerEntry()`'s
hard `ledgerMode` filter (`PERFORMANCE_ARCHITECTURE.md`), a backtest can
never contaminate a live financial ledger, enforced at two independent
layers (the literal type here, the filter there).

Because there's no external execution provider in a backtest by
definition, a backtest's own `calculatedReturn` is treated as that
record's `actualPayout` for PAPER-ledger aggregation purposes — see
`FINANCIAL_ACCOUNTING.md`'s "PAPER's own actual-figures convention" for
why this is safe (it never reaches a LIVE ledger, and it's never labeled
`PayoutSource.PROVIDER`).

## Backtest predictive metrics (§34)

```ts
function computeBacktestPredictiveMetrics(points: readonly BacktestDecisionPoint[]): BacktestPredictiveMetrics
// { sampleCount, accuracy, logLoss, brierScore }
```

Filters to 1X2 decision points only (accuracy/log-loss/Brier score are
1X2-specific in this codebase — forcing them onto Over/Under or BTTS
would be a classification metric applied where it isn't meaningful,
which §35 explicitly forbids). Reads the point's own **full** `{home,
draw, away}` `probability1x2` distribution — not a value reconstructed
from a single-selection `ValueAssessment` — and calls Section 05's real
`accuracy1x2`/`logLoss1x2`/`brierScore1x2` (`evaluation/metrics.ts`)
directly, never a second implementation. Returns `sampleCount: 0` and
every metric `null` (never a forced/meaningless number) when zero 1X2
points are supplied.

CLV, ROI, max drawdown, and longest losing streak for a backtest run are
computed the same way as any live performance ledger — via
`backtestToPerformanceRecordInput()` feeding `buildPerformanceLedgerEntry()`
(see `PERFORMANCE_ARCHITECTURE.md`) — never a second aggregation
algorithm for backtests specifically.

## Baselines and calibration (§35/§36)

Section 05's baseline comparisons (naive, Elo, market/odds-implied) and
calibration architecture (Platt/isotonic, time-safe selection) are
unchanged and reused as-is when evaluating a backtest's underlying model
— `backtest.ts` calls the same `evaluateValue()`/model pipeline live
decisions use, so whatever baseline/calibration choices that pipeline
already makes apply identically here. Nothing in Section 08 alters,
re-ranks, or hides a baseline's result to favor a more complex model —
if a simple baseline outperforms in a given backtest window, that
appears in the same `BacktestPredictiveMetrics`/`PerformanceLedgerEntry`
figures the complex model's does, with no special-casing.

Predictive-quality metrics (accuracy, log loss, Brier score, calibration
quality — Section 05's concern) and financial profitability (ROI, net
P&L — Section 08's concern) are always reported as **separate** figures
on a backtest run's results, never collapsed into one score. A
well-calibrated model can lose money under poor pricing; a profitable
sample can be poorly calibrated — both are visible, neither overwrites
the other.

## Persistence

```
backtest_runs     — training_run_id / evaluation_run_id (FK to
                     intelligence_training_runs / intelligence_evaluation_runs,
                     nullable — never duplicating window/model/dataset
                     lineage columns), decision_policy_version,
                     settlement_policy_version, stake_per_ticket (> 0),
                     currency, status (reuses training_run_status enum)
backtest_results  — backtest_run_id, performance_ledger_id (nullable FK —
                     the SAME buildPerformanceLedgerEntry() rollup every
                     live/paper entry uses), sample_count, accuracy,
                     log_loss, brier_score, clv_average, clv_sample_count,
                     by_market (jsonb), by_league (jsonb)
```

`backtest_runs.status` reuses the existing `public.training_run_status`
enum (`running`/`completed`/`failed`) rather than a near-duplicate — "do
not duplicate an existing Section 05 evaluation contract" holds at the
schema level, not just in TypeScript. `stake_per_ticket > 0` is a real
`CHECK` constraint — never an invented/free stake
(`tests/database/120_section08_rls_cases.sql` TEST 27).
`clv_sample_count` is always the true denominator for `clv_average`,
never assumed equal to `sample_count` (not every decision point resolves
a real closing price).

## Historical reproducibility (§32/§43)

Every `BacktestDecisionPoint` carries `modelVersion`, `dataQuality`,
`oddsTimestamp` (provenance for the odds used), and its `TrainingExample`
carries `snapshotTime`/`fixtureId`/lineage back to Section 05's dataset
builder. A `backtest_runs` row anchors a full run to a specific
`training_run_id`/`evaluation_run_id`/`decision_policy_version`/
`settlement_policy_version` — re-running the same window against the
same versions is expected to reproduce the same simulated outcomes,
since every function in the pipeline (`evaluateValue`, `settleTicketLegs`,
`computeBacktestPredictiveMetrics`) is pure and deterministic given the
same inputs.

## See also

- [`SETTLEMENT_ARCHITECTURE.md`](./SETTLEMENT_ARCHITECTURE.md) — the
  live settlement engine this module reuses.
- [`PERFORMANCE_ARCHITECTURE.md`](./PERFORMANCE_ARCHITECTURE.md) — the
  shared aggregator backtest results feed into.
- [`LEAKAGE_PROTECTION.md`](./LEAKAGE_PROTECTION.md) — Section 04/05's
  point-in-time query and walk-forward guarantees this module builds on.
- [`MODEL_VALIDATION.md`](./MODEL_VALIDATION.md) — Section 05's
  evaluation framework, reused unmodified.
- `packages/football-engine/src/backtest.test.ts` — 12 tests, including
  the `BACKTEST_FUTURE_ODDS` leakage guard.
