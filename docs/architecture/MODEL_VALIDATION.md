# Model Validation (Section 05)

This document is the evaluation methodology reference
`FOOTBALL_INTELLIGENCE.md` points to — how a model, baseline, or
ensemble is actually validated in this codebase, and the discipline
around not overstating what a small, synthetic-data validation run can
prove.

## Why chronological, not random, splitting

Football outcomes are temporally correlated (form, injuries, squad
changes, competition context all evolve over a season) and the whole
point of this section is to answer "would this model have worked using
only information available before each match" — a random split
answers a different, easier, and misleading question, since it lets a
model trained on data from *after* a test match implicitly leak
context about it. `validation/walk-forward.ts` is the only sanctioned
splitting mechanism in this package; nothing in `packages/football-engine`
calls `Math.random()` (or any shuffle) to build a train/test split.

## Walk-forward configuration

```ts
interface WalkForwardConfig {
  minTrainingPeriodDays: number;
  validationPeriodDays: number;
  testPeriodDays: number;
  stepDays: number;      // how far the training window's end advances per successive window
  embargoDays: number;   // gap enforced between train→validation and validation→test
  minSamplesPerWindow: number;
  competitionIds?: readonly UUID[];
}
```

**Expanding window** (documented choice, see `FOOTBALL_INTELLIGENCE.md`):
`trainStart` is fixed at the dataset's earliest example; `trainEnd`
grows by `stepDays` each window. A window is only emitted once every
segment meets `minSamplesPerWindow` — with a small dataset (this
section's synthetic data, at most a few dozen matches) that can mean
**zero** windows are generated for a strict configuration, which is a
correct, tested outcome
(`validation/walk-forward.test.ts`'s "returns an empty array rather
than throwing"), not a bug to work around by loosening leakage rules.

**Embargo**: a gap between segments guards against near-boundary time
correlation (e.g. two matches of the same round, days apart, that
share almost all the same "recent form" context) leaking training
signal into validation/test through proximity rather than genuine
predictive information.

## Model selection discipline (§28)

The system supports comparing, side by side, on the **same**
walk-forward test window: `naiveBaseline`, `historicalFrequencyBaseline`,
`eloBaseline`, `poissonBaseline`, `marketImpliedBaseline` (baselines);
the Poisson and Dixon-Coles statistical models; `RandomForestModel`,
`GradientBoostedTreesModel`, `NeuralNetworkModel` (ML); the ensemble;
the calibrated ensemble — via the exact same
`evaluation/metrics.ts`/`evaluation/summary.ts` functions applied to
each one's predictions on the same test examples.

**Nothing in this codebase assumes the most complex model is best.**
`buildEvaluationSummary()` reports the real numbers
(`accuracy`/`logLoss`/`brierScore`/`expectedCalibrationError`/
breakdowns) for whatever was evaluated — there is no "ranking score"
that collapses these into a single misleading "winner," and no code
path that discards or hides a baseline's result because it happened to
outperform a fancier model. If a complex model cannot beat
`historicalFrequencyBaseline` on real walk-forward test data, that
result is exactly as reportable as the reverse.

**No claim of real-world accuracy is made anywhere in this codebase or
its documentation.** Every test in `packages/football-engine` that
exercises a model or evaluation metric uses clearly synthetic,
deterministic fixture data (see "Synthetic data discipline" below) —
the `>90% accuracy` assertions in `models/models.test.ts`, for example,
are sanity checks that a training algorithm can learn a perfectly
separable toy signal, not a benchmark of football-prediction skill.
There has not yet been a walk-forward evaluation against real
historical football data, because no real data exists in this
repository — see `FOOTBALL_DATA_ARCHITECTURE.md`'s "Providers actually
connected."

## ML runtime boundary

No ML runtime dependency (TensorFlow.js, ONNX Runtime, a native
`xgboost`/`lightgbm` binding) was added this section. Every model
(`models/decision-tree.ts`, `random-forest.ts`,
`gradient-boosted-trees.ts`, `neural-network.ts`) is a genuine,
from-scratch TypeScript implementation of its family's real algorithm.

**Why not add a dependency instead:**
- The dataset scale this section operates at (a synthetic fixture set,
  and any realistic near-term real dataset) does not need a
  production-grade native ML runtime's performance characteristics.
- A native binding (e.g. `xgboost`'s C++ core via N-API) would need a
  build step, platform-specific binaries, and a story for how it runs
  identically in this monorepo's TypeScript-only CI/build pipeline —
  none of which currently exists, and none of which this section was
  asked to introduce ("do not introduce unsupported dependencies or
  runtimes without documenting and justifying them").
- A pure-JS ML library still means depending on someone else's
  implementation for algorithms genuinely tractable to implement
  correctly and testably in a few hundred lines each — which this
  section did, with deterministic seeded tests proving each one learns
  a real signal (see `models/models.test.ts`).

**What would change this decision:** a real dataset large enough that
this package's tree-training loops become a measured bottleneck, or a
requirement for an algorithm not reasonably implementable from scratch
(e.g. a large transformer). Neither applies yet — see
`OPEN_QUESTIONS.md`'s "future ML runtime boundary if TS is
insufficient".

## Synthetic data discipline

Every dataset used in a test in `packages/football-engine` is either:
1. Hand-authored, obviously synthetic fixture/result data (generated
   team/competition ids, deterministic scores, synthetic provider
   names like `pipeline_test`/`baseline_test`), or
2. A toy, explicitly-labeled-separable dataset used only to validate
   that a training algorithm's mechanics are correct (e.g.
   `buildSeparableExamples()` in `models/models.test.ts`).

No test claims, implies, or could be mistaken for a real-world
football accuracy benchmark. If/when a real provider is connected
(Section 04's open question), a genuine walk-forward evaluation against
real historical data — and honest reporting of whatever it finds,
including "the baseline won" — is the natural next step, not assumed
here.

## Determinism

Every source of randomness in this package accepts an explicit seed:
Monte Carlo sampling (`monte-carlo.ts`'s `createSeededRng`), Random
Forest bootstrap sampling and feature subsampling, Gradient Boosted
Trees' tree construction, the Neural Network's weight initialization
and per-epoch example shuffling, and ensemble-weight/calibrator
gradient descent. No test depends on wall-clock time unless a fixed
`now`/timestamp is explicitly injected (every dataset-builder,
feature-computation, and model-training call in this package's tests
passes one). Every "is deterministic given the same seed" test in this
package asserts exact equality (`toEqual`), not an approximate
tolerance, between two independent runs.

## See also

- [`FOOTBALL_INTELLIGENCE.md`](./FOOTBALL_INTELLIGENCE.md)
- [`LEAKAGE_PROTECTION.md`](./LEAKAGE_PROTECTION.md) (Section 04)
- `packages/football-engine/src/section-05-leakage.test.ts`
- `packages/football-engine/src/pipeline-integration.test.ts`
