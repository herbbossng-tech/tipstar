# Football Intelligence (Section 05)

Section 05 builds the point-in-time-safe feature/model layer on top of
Section 04's trustworthy data boundary:

```
POINT-IN-TIME DATA (Section 04's getDataAsOf / repository *AsOf methods)
   ↓
FEATURE DEFINITIONS
   ↓
TIME-AWARE FEATURE STORE
   ↓
TRAINING DATASET BUILDER
   ↓
WALK-FORWARD VALIDATION
   ↓
BASELINES → ML MODELS → STATISTICAL MODELS → MONTE CARLO
   ↓
ENSEMBLE → CALIBRATION → PROBABILITY CONSISTENCY
   ↓
MODEL OUTPUT CONTRACT
```

This section produces **intelligence** (probabilities, versioned model
artifacts, evaluation metrics) — it does not decide what to publish,
what to wager, or execute anything. Those are Section 07's job.

## Provider capability matrix

Every intelligence feature this section could plausibly compute,
evaluated against what Section 04's canonical model (`canonical.ts`)
and its one connected adapter (`test_fixture_provider`, a deterministic
synthetic dataset — see `FOOTBALL_DATA_ARCHITECTURE.md`) actually
support today. **Available now** means real canonical data exists to
compute it from — not that a live provider has been verified to supply
it at scale; no live provider is connected (Section 04, unchanged).

| Capability | Required by | Available now | Canonical source | Point-in-time safe | Fallback |
|---|---|---|---|---|---|
| Fixture identity, kickoff, competition/season | every family | **Yes** | `fixtures`/`competitions`/`seasons` | Kickoff is scheduled info, always safe | — |
| Historical results (final score) | Elo, Form, Goals, H2H, baselines, Poisson/Dixon-Coles | **Yes** | `match_results` | Gated on `resultRecordedAt <= snapshotTime` | — |
| Team identity / home-away | Home/Away, Elo | **Yes** | `teams`, `fixtures` | n/a | — |
| Match events (goals/cards/subs timing) | (not built as its own family this section) | Yes, but very low volume in the one synthetic dataset (2 records) | `match_events` | Gated on `observedAt <= snapshotTime` | Deliberately **deferred** — see "Explicitly not implemented" below, not because the data is unavailable but to keep this section's scope bounded per its own "prioritize" instruction |
| Standings (position, points, GD) | Standings family | **No** | Would be `team_observations` with `observationType="standings"`, but no ingestion path populates it — Section 04 `OPEN_QUESTIONS.md` #12 | n/a | Feature family declared, disabled, `quality: MISSING` for every value |
| Team statistics (shots/possession/corners aggregates) | Team Statistics family | **No** | Same `team_observations` gap as standings | n/a | Declared, disabled |
| xG (expected goals) | xG family | **No** | No field anywhere in the canonical model | n/a | Declared, disabled — **never substitutes goals for xG** |
| Player availability / lineups / injuries / suspensions | (none — no market depends on it this section) | **No** | No `Player`/`Lineup`/`PlayerAvailability` entity exists (Section 04 deliberately did not build one — "avoid premature player-level complexity") | n/a | Not modeled; documented as an open question |
| Historical odds (price, market, selection) | Odds features, market-implied baseline, fair-odds contract prep | **Yes** | `odds_observations` | Gated on `observedAt <= snapshotTime` + `temporalReliability` | `ESTIMATED`-reliability observations are used but never treated as equal-confidence to `CONFIRMED` ones (surfaced in feature quality metadata) |
| Odds closing values | — | **Deliberately not used pre-match** | `odds_observations` | The spec is explicit: *"Never use closing odds if the feature snapshot occurs before closing."* Every feature snapshot in this section is pre-match by construction, so a "closing price" feature is never computed | — |
| H2H (prior meetings between the same two teams) | H2H family | **Yes**, cautious | `match_results` + `fixtures` | Reuses the same `resultRecordedAt`-gated history helper as Elo/Form | Below a minimum-observation threshold, H2H features report `MISSING`, never a noisy value from 1 match |

### Feature families actually implemented this section

Team Strength (Elo), Form, Rest/Schedule, Home/Away, Goal features, H2H,
Odds features — all computed from real Section 04 data, all point-in-time
safe, all covered by leakage regression tests. See `feature-families.ts`
docs below for each.

### Feature families declared but disabled (never fabricated)

xG, Team Statistics, Standings — the `FeatureDefinition` for each exists
(so Section 05's architecture and Section 06+'s consumers have a stable
name/shape to target once a provider supplies the underlying data), but
`enabled: false` and every computation returns `quality: "MISSING"`,
never a fabricated number. See `features/unavailable.ts`.

### Explicitly not implemented this section

- A dedicated match-events-derived "discipline" feature (cards/game) —
  the data exists (`match_events`) and is point-in-time safe, but with
  only 2 synthetic event records in the one adapter this section has,
  there is nothing to meaningfully validate a rolling-average feature
  against yet. Deferred rather than built as an unvalidated stub — see
  `OPEN_QUESTIONS.md`.
- Player/lineup/injury-dependent features — no canonical entity exists.

## Feature architecture

`packages/football-engine/src/features/types.ts` separates:

- **FeatureDefinition** — a feature's stable identity: `featureId`,
  `name`, `version`, `family`, `dataDependencies`, `lookback`,
  `computationTimestampRule`, `availabilityRequirement`,
  `missingValuePolicy`, `leakageRisk`, `enabled`. Lives in code
  (`features/*.ts`), not a database table — see "Database / Persistence"
  below.
- **FeatureValue** — one computed number (or `null`) for one
  `(featureId, fixtureId, snapshotTime)`, tagged with `featureVersion`,
  `dataQuality` (`AVAILABLE`/`MISSING`/`STALE`/`INVALID`/`SYNTHETIC`/
  `LOW_CONFIDENCE`), and `sourceVersion`. Never a bare number — quality
  is a first-class part of every value, per the spec's "missingness must
  not be confused with a real zero."
- **FeatureVector** — every `FeatureValue` for one fixture at one
  snapshot, keyed by `featureId` (`features/registry.ts`'s
  `computeFeatureVector`).

Every feature-family file (`elo.ts`/`form.ts`/`rest-schedule.ts`/
`home-away.ts`/`h2h.ts`/`odds.ts`/`unavailable.ts`) exports its
`FeatureDefinition[]` and a `computeXFeatures()` function; the registry
just calls each and merges the results. Nothing is persisted beyond
that — see "Feature Store" below.

### The one leakage-safe history primitive

`features/history.ts`'s `getTeamMatchHistory`/`getGlobalMatchHistory`
are the single implementation every rolling feature (Elo, Form,
Rest/Schedule, Home/Away, H2H) builds on: a past match is only visible
if **both** (1) its kickoff was strictly before the target fixture's
kickoff, and (2) its `MatchResult.resultRecordedAt <= snapshotTime` —
the same two-condition rule `LeakageGuard.getDataAsOf` (Section 04)
applies to a single fixture's own data, generalized to a team's or the
league's full match history. Every feature family reads through this
one function rather than re-deriving its own leakage filter.

### Feature Store — a deliberate non-decision

`feature-store.ts` does **not** persist a feature-value matrix. The
spec is explicit: *"Do not persist enormous redundant feature matrices
if the architecture does not require them. Prefer reproducibility
through: immutable dataset/version references, feature definitions,
source snapshot timestamps, deterministic computation."* Every
`FeatureValue` is cheap to recompute deterministically from Section
04's stored data plus a `FeatureDefinition`'s version, so a cache buys
nothing a `computeFeatureVector()` call doesn't already give for free.
`feature-store.ts` is instead the read API for the `FeatureDefinition`
catalog itself.

## Training dataset builder

`dataset/builder.ts`'s `buildTrainingDataset()`. Each
`TrainingExample` = `{fixtureId, competitionId, seasonId, kickoffTime,
snapshotTime, features, target1x2, targetTotalGoals, targetBtts,
datasetVersion, builtAt}`. Labels (`target1x2`/`targetTotalGoals`/
`targetBtts`) are prioritized per the spec ("1X2, total goals, BTTS")
and derived from the fixture's real, final `MatchResult` — labels are
always allowed to see the eventual outcome (that's what makes them
labels); leakage would only occur if a *feature* could see it too,
which the snapshotTime gate prevents. `snapshotTime` is computed via
Section 04's `computePreMatchSnapshotTime(fixture, leadTimeMinutes)`
(never a hard-coded lead time) and is rejected outright — the fixture is
excluded, not silently included — if it is ever not strictly before
kickoff (a direct target-leakage guard). A fixture with no recorded
result is excluded with a reason, never silently dropped.

## Walk-forward validation

`validation/walk-forward.ts`. Chronological only — **never** a random
train/test split for temporal football prediction. Implements an
**expanding training window**: `trainStart` is fixed at the dataset's
earliest example, `trainEnd` grows by `stepDays` each successive
window, followed by a `validationPeriodDays` window and a
`testPeriodDays` window, each separated from its neighbor by an
`embargoDays` gap. This is a documented choice, not the only valid one
— a rolling fixed-size window is a legitimate alternative the spec does
not mandate. `generateWalkForwardWindows()` only emits a window once
every segment (train/validation/test) meets `minSamplesPerWindow` —
with too little data it returns `[]` rather than throwing, a legitimate
"not enough data" outcome. `splitExamplesByWindow()` never shuffles.

## Baselines

`baselines.ts` — the reference points every complex model must beat to
justify its existence (spec §10/§28: *"Do not declare a model superior
without evaluation evidence... If a complex model cannot beat a
baseline under proper walk-forward validation, the system must preserve
that result rather than hiding it."*):

| Baseline | Basis |
|---|---|
| `naiveBaseline()` | Fixed equal-probability (1/3 each) — the textbook "no domain knowledge" baseline. |
| `historicalFrequencyBaseline()` | Empirical HOME/DRAW/AWAY frequency from the competition's history known by `snapshotTime`. |
| `eloBaseline()` | Elo expected-score formula split between home/away, using the empirical draw rate for `P(draw)` — a standard, documented Elo→1X2 conversion technique, not an ad hoc invention. |
| `poissonBaseline()` | Thin glue over the statistical engine's Poisson scoreline distribution. |
| `marketImpliedBaseline()` | Odds-derived implied probabilities, overround removed by proportional normalization — **only** computed when trustworthy pre-snapshot 1X2 odds exist for all three selections; fails closed (`ODDS_UNAVAILABLE`) otherwise. |

Every baseline that needs historical data returns
`INSUFFICIENT_HISTORICAL_DATA` rather than fabricating a plausible-looking
prior when a competition has no prior matches known by `snapshotTime`.

## Statistical engine

`statistical/poisson.ts` — the classic attack/defense strength Poisson
model (Maher 1982): each team's home/away attack and defense strength
is expressed relative to the competition's average goals, computed only
from historical matches known by `snapshotTime`; expected goals =
league average × attacking team's attack strength × defending team's
defense strength, floored at a small positive constant so a sparse
estimate never collapses a Poisson distribution to a degenerate point
mass. `poissonPmf()` is tested against exact textbook values.

`statistical/dixon-coles.ts` — a genuine implementation of Dixon &
Coles (1997)'s τ (tau) low-score correction (tested against the exact
published 4-case formula) and its exponential time-weighting, with one
documented simplification: ρ (rho) is fit by a bounded log-likelihood
grid search using the *final, static* attack/defense-derived expected
goals for every historical match, rather than the paper's fully
time-varying re-estimation at each historical point — a real
implementation of the tau methodology, not a class with the right name
and no math behind it, at a computational cost this section's scope
does not require paying in full.

Both share `probability/scoreline.ts`'s `ScorelineDistribution` — every
market (1X2, BTTS, Over/Under) derives from the SAME distribution via
`derive1x2FromScoreline`/`deriveBttsFromScoreline`/
`deriveOverUnderFromScoreline`, satisfying §16's "derive markets
consistently instead of generating contradictory independent
probabilities" directly, by construction, rather than by convention.

## Monte Carlo engine

`monte-carlo.ts`. A seeded `mulberry32` PRNG (deterministic, no
external dependency) samples `iterations` scorelines from an input
`ScorelineDistribution` via inverse-CDF sampling, then derives every
output market from the resulting *empirical* distribution using the
same `probability/scoreline.ts` functions above. Tested for exact
reproducibility given the same seed, and for convergence — the
empirical distribution measurably approaches the analytic input
distribution as `iterations` grows (a direct sanity check the spec
asks for, not merely asserted). Reports a sampling standard error
alongside the probability — explicitly *sampling* uncertainty, never
conflated with real-world confidence.

## ML model abstraction

`models/types.ts`'s `MlModel` interface: `predictProba`/`predict`/
`serialize`, with `ModelMetadata` recording `modelFamily`,
`modelVersion`, `trainingDatasetVersion`, `featureSchema`,
`hyperparameters`, `randomSeed`, `trainingTimestamp`,
`evaluationReference`. `models/encode.ts` fits a median imputer and
resolves the feature-column schema — **only from the training split**,
stored as part of the serialized model state, applied identically
(never refit) at validation/test/inference time.

### Runtime boundary decision

No ML runtime dependency (TensorFlow.js, ONNX, a native `xgboost`
binding) was added. Every model below is a real, from-scratch
TypeScript implementation of its family's actual algorithm — not a toy
standing in for one:

- **Decision tree** (`models/decision-tree.ts`) — genuine CART,
  variance-reduction split criterion, the shared base learner for both
  ensembles below.
- **Random Forest** (`models/random-forest.ts`) — bootstrap-bagged
  trees with random per-split feature subsampling, one forest per
  outcome class (one-vs-rest), normalized via `one-vs-rest.ts`.
- **Gradient Boosted Trees** (`models/gradient-boosted-trees.ts`) —
  real logistic gradient boosting (each tree fit to the negative
  gradient of log-loss, added with learning-rate shrinkage) — the same
  mathematical family XGBoost/LightGBM/GBM belong to, not a binding to
  any of those specific libraries. Also serves this section's separate
  "Gradient Boosting" family via different hyperparameters, rather than
  a second, nearly-identical implementation.
- **Neural Network** (`models/neural-network.ts`) — a real single-
  hidden-layer MLP (tanh hidden layer, softmax output) trained by full
  backpropagation with per-example SGD and L2 weight decay; inputs
  standardized using training-only statistics.

This was a deliberate choice over adding a large ML dependency for a
handful of small, section-scale models: every model here has
reproducible setup (no native build step), deterministic tests (fixed
seeds throughout), and no client-bundle exposure risk (server/
package-only code). See `MODEL_VALIDATION.md`'s "ML runtime boundary"
for the explicit trade-off and what would change this decision.

## Ensemble

`ensemble.ts`. `combineEnsemble()` — a weighted average of named
component predictions, renormalized when a component is absent for a
given fixture (e.g. no trustworthy odds) rather than corrupting the
sum-to-1 invariant. Weights come from exactly one of two places, never
an unexplained arbitrary scheme:

1. **`configured_baseline`** — a fixed, explicitly documented
   experiment, never claimed to be tuned or optimal.
2. **`learned`** — `learnEnsembleWeights()` fits weights by gradient
   descent on a softmax reparameterization (guaranteeing non-negative
   weights summing to 1 by construction), minimizing multiclass
   log-loss over a **validation-period sample the caller supplies** —
   test data must never reach this function, and nothing in its
   signature could accept it by accident. The exact gradient
   (`dL/dtheta_j = w_j · (1 - P_j(actual)/p_actual)`) is derived, not
   guessed, and tested against a case where one component is
   consistently right and another consistently wrong — the fit
   correctly assigns nearly all weight to the correct one.

## Calibration

`calibration.ts`. Two real, independent calibrators, each fit
one-vs-rest per class then renormalized:

- **Platt (logistic)** — `calibrated = sigmoid(a·raw + b)`, `a`/`b`
  fit by gradient descent on log-loss.
- **Isotonic** — Pool Adjacent Violators (PAVA), the standard algorithm
  for fitting a monotone non-decreasing step function, with linear
  interpolation between fitted blocks and flat extrapolation beyond the
  training range.

`selectCalibrator()` picks whichever candidate has lower log-loss on a
**validation-period sample** — never fit on that sample itself, and
never on the test set. Every calibrator records `calibratorType`/
`calibratorVersion`/`trainingRangeStart`/`trainingRangeEnd`/
`inputModelVersion`/`calibrationDatasetVersion`.

## Probability consistency engine

`probability/consistency.ts`. Fail-closed validation, never
clamp-and-continue: `checkProbability1x2`/`checkBinaryProbability`/
`checkScorelineDistribution` reject any probability that is negative,
`> 1`, `NaN`, `Infinity`, or a distribution that does not sum to 1
(within a `1e-6` floating-point tolerance — genuine rounding only, never
a materially wrong distribution). `checkOverUnderCoherence` enforces
that a higher goal-line's Over probability can never exceed a lower
line's, when both are derived from the same distribution. Every model
family's output — baselines, Poisson/Dixon-Coles, Monte Carlo, ML
models, the ensemble, the calibrated result — passes through this
before being trusted further.

## Evaluation framework

`evaluation/metrics.ts` + `evaluation/summary.ts`. Multiclass (1X2):
`accuracy1x2`, `logLoss1x2`, `brierScore1x2`, plus a calibration-quality
summary (`calibrationBuckets1x2`/`expectedCalibrationError1x2` — the
standard Expected Calibration Error, sample-weighted mean
|confidence − accuracy| across confidence buckets). Binary markets:
`accuracyBinary`, `precisionRecallBinary`, `logLossBinary`,
`brierScoreBinary`, `rocAucBinary` (an exact Mann-Whitney-U-based
computation, not an approximation — tested against perfect separation
= 1.0, a symmetric random predictor = 0.5, and correctly `NaN` — never
a fabricated 0.5 — when only one class is present). `buildEvaluationSummary()`
also tracks sample count, missing-feature rate, the full data-quality
status distribution, and breakdowns by competition and by season.
**Deliberately no ROI/realized-profit metric** — that belongs to a
later performance/backtesting layer, per the spec.

## Prediction output contract & fair odds

`output-contract.ts`. `PredictionOutput` — `fixtureId`,
`predictionTimestamp`, `snapshotTime`, `modelVersion`,
`ensembleVersion`, `calibrationVersion`, `dataQuality`,
`homeWinProbability`/`drawProbability`/`awayWinProbability`, a
`markets[]` array (1X2 plus any additional supported market, each with
a computed `fairOdds`), `featureVersions`, `uncertainty` (sampling
standard error where applicable, plus a fixed note that this is *"a
statistical probability estimate, not a guarantee"*), and `provenance`
(source version, ensemble component contributions when applicable).
Fails closed via the consistency engine before construction.

**`fairOdds = 1 / probability`**, undefined only for a zero probability
— never a bookmaker price, and margin removal from real market prices
is a baseline concern (`marketImpliedBaseline`), not something this
contract does implicitly. Sport Agent selection logic (Section 07) is
explicitly not built here — this contract is prepared for it, not a
step toward it.

**No certainty language.** Nothing in this module, or any caller, may
use "sure"/"guaranteed"/"banker"/equivalent words. `probability` and
`confidence` are never used interchangeably — see `uncertainty`'s
explicit, separate field.

## Leakage defenses — full checklist

See `packages/football-engine/src/section-05-leakage.test.ts` for the
permanent, explicit checklist covering every category the spec names
(future result/event/odds/Elo/form/standings/statistics/H2H, target
leakage, train/test contamination, scaler/encoder/imputer leakage,
calibration leakage, ensemble-weight leakage) with either a direct test
or a pointer to exactly which existing test proves it — nothing on the
list is asserted without a reproducible test behind it.

## Database / Persistence

Six new tables (`supabase/migrations/20260929140*`), matching exactly
what §21 asks to be persisted: `intelligence_dataset_versions`,
`intelligence_model_versions` (including each model's fitted, JSON-
serializable state), `intelligence_calibration_versions`,
`intelligence_ensemble_versions`, `intelligence_training_runs`
(with DB-level `CHECK` constraints mirroring `walk-forward.ts`'s own
chronology invariant), `intelligence_evaluation_runs`. **Feature
definitions are deliberately NOT a table** — they are code-versioned
(`features/*.ts` + the `version` field), and the spec's own
reproducibility principle ("prefer reproducibility through... feature
definitions... deterministic computation") argues for that, not a
database mirror of what's already in git history.

RLS follows Section 04's operational-table pattern exactly: every table
is admin-only `SELECT` (never broad `authenticated` access, since this
is internal ML-pipeline metadata, not user-facing content),
`service_role` full access, no `INSERT`/`UPDATE`/`DELETE` policy for
`authenticated`/`anon` anywhere — model training and evaluation are
exclusively server-side operations. Validated against real Postgres 16
— see `tests/database/60_intelligence_rls_cases.sql`.

A large-scale retrain producing much bigger model artifacts (many deep
trees, a large network) than this section's synthetic-data scale would
need blob/file storage instead of the `state jsonb` column used here —
see `OPEN_QUESTIONS.md`'s "production model artifact storage strategy".
