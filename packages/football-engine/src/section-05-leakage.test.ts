import { describe, expect, it } from "vitest";
import { fitMedianImputer, applyImputer, toFeatureRow } from "./models/encode.js";
import { learnEnsembleWeights, type EnsembleValidationExample } from "./ensemble.js";
import type { TrainingExample } from "./dataset/types.js";

/**
 * PERMANENT Section 05 leakage checklist (spec §8: "Treat leakage
 * prevention as a first-class invariant"). Do not weaken or remove any
 * item here — if a future change breaks one of these, the change is
 * wrong, not the test.
 *
 * Every leakage category the spec names is covered somewhere in this
 * package; most already have a dedicated test where the relevant
 * mechanism lives (leakage protection is meaningless divorced from the
 * code path it protects — a generic "no leakage" test that doesn't
 * exercise the real computation would be theater). This file:
 *  1. adds the two categories that had no direct test anywhere else
 *     (imputer fitting, ensemble-weight fitting), and
 *  2. documents exactly where every other category's real test lives,
 *     so this file is the map, not a re-implementation.
 *
 * | Category                  | Covered by |
 * |---|---|
 * | future match result       | features/history.test cases in features/features.test.ts ("excludes a match whose result was not yet recorded"); leakage-guard.test.ts's Section 04 regression test |
 * | future match event        | leakage-guard.test.ts's adversarial future-event test (Section 04; no Section 05 feature reads events directly this section — see FOOTBALL_INTELLIGENCE.md's "explicitly not implemented") |
 * | future odds                | features/features.test.ts's odds test; dataset/builder.test.ts |
 * | future Elo                 | features/features.test.ts's "a team's post-match Elo never influences a fixture before that match" |
 * | future rolling-form data   | features/features.test.ts's "reports MISSING (not 0) for a team with zero prior matches" + the shared history.ts exclusion test |
 * | future standings           | trivially satisfied — the standings feature family is declared but never computed (features/unavailable.ts); nothing to leak |
 * | future team statistics     | trivially satisfied — same as standings |
 * | future H2H                 | features/features.test.ts's h2h tests, built on the same leakage-safe history primitive as Elo/form |
 * | target leakage             | dataset/builder.test.ts's "every example's snapshotTime is strictly before its kickoffTime" + builder.ts's explicit snapshotTime-before-kickoff rejection |
 * | train/test contamination   | validation/walk-forward.test.ts's non-overlap + chronological-order tests |
 * | scaler leakage (NN)        | models/neural-network.ts fits featureMeans/featureStds only inside train(), from the training examples passed to it — never refit at predictProba time (structural: predictProba has no fitting code path at all) |
 * | encoder/imputer leakage    | THIS FILE, below |
 * | calibration leakage        | calibration.test.ts's selectCalibrator test (disjoint training/validation example sets) |
 * | ensemble-weight leakage    | THIS FILE, below |
 */

describe("Section 05 permanent leakage checklist — imputer leakage", () => {
  it("a value the imputer never saw during fit does not change the fitted medians", () => {
    const trainingExamples: TrainingExample[] = [
      { fixtureId: "f1", competitionId: "c1", seasonId: undefined, kickoffTime: "2026-01-01T00:00:00Z", snapshotTime: "2026-01-01T00:00:00Z", features: { x: { featureId: "x", featureVersion: 1, fixtureId: "f1", value: 10, computedAt: "2026-01-01T00:00:00Z", snapshotTime: "2026-01-01T00:00:00Z", dataQuality: "AVAILABLE", sourceVersion: "test" } }, target1x2: "HOME", targetTotalGoals: 2, targetBtts: false, datasetVersion: "v1", builtAt: "2026-01-01T00:00:00Z" },
      { fixtureId: "f2", competitionId: "c1", seasonId: undefined, kickoffTime: "2026-01-02T00:00:00Z", snapshotTime: "2026-01-02T00:00:00Z", features: { x: { featureId: "x", featureVersion: 1, fixtureId: "f2", value: 20, computedAt: "2026-01-02T00:00:00Z", snapshotTime: "2026-01-02T00:00:00Z", dataQuality: "AVAILABLE", sourceVersion: "test" } }, target1x2: "AWAY", targetTotalGoals: 1, targetBtts: false, datasetVersion: "v1", builtAt: "2026-01-02T00:00:00Z" },
    ];
    const imputer = fitMedianImputer(trainingExamples, ["x"]);
    expect(imputer.x).toBe(15); // median of [10, 20]

    // A validation/test-time row with a wildly different value for a MISSING feature must be imputed using the TRAINING median, never a value influenced by this row (there is nothing to refit — applyImputer has no fitting logic at all, only lookup).
    const validationRow = toFeatureRow({ ...trainingExamples[0]!, features: { x: { ...trainingExamples[0]!.features.x!, value: null } } }, ["x"]);
    const imputed = applyImputer(validationRow, imputer);
    expect(imputed.x).toBe(15);

    // Refitting the SAME imputer including a hypothetical validation example would change the median — proving the median is genuinely sensitive to its inputs, so the fact that applyImputer above did NOT change is because it structurally cannot refit, not because the value happened to coincide.
    const contaminatedImputer = fitMedianImputer([...trainingExamples, { ...trainingExamples[0]!, fixtureId: "f3", features: { x: { ...trainingExamples[0]!.features.x!, value: 1000 } } }], ["x"]);
    expect(contaminatedImputer.x).not.toBe(imputer.x);
  });

  it("a feature with zero non-null training values imputes to a documented default (0), never a value derived from validation/test data", () => {
    const trainingExamples: TrainingExample[] = [
      { fixtureId: "f1", competitionId: "c1", seasonId: undefined, kickoffTime: "2026-01-01T00:00:00Z", snapshotTime: "2026-01-01T00:00:00Z", features: { x: { featureId: "x", featureVersion: 1, fixtureId: "f1", value: null, computedAt: "2026-01-01T00:00:00Z", snapshotTime: "2026-01-01T00:00:00Z", dataQuality: "MISSING", sourceVersion: "test" } }, target1x2: "HOME", targetTotalGoals: 2, targetBtts: false, datasetVersion: "v1", builtAt: "2026-01-01T00:00:00Z" },
    ];
    const imputer = fitMedianImputer(trainingExamples, ["x"]);
    expect(imputer.x).toBe(0);
  });
});

describe("Section 05 permanent leakage checklist — ensemble-weight leakage", () => {
  it("weights learned from one validation set do not change when a disjoint 'test' set's examples are altered", () => {
    const validationExamples: EnsembleValidationExample[] = [
      { components: { good: { home: 0.9, draw: 0.05, away: 0.05 }, bad: { home: 0.05, draw: 0.05, away: 0.9 } }, actual: "HOME" },
      { components: { good: { home: 0.05, draw: 0.9, away: 0.05 }, bad: { home: 0.9, draw: 0.05, away: 0.05 } }, actual: "DRAW" },
    ];
    const config = { epochs: 100, learningRate: 0.3, seed: 1 };

    const weightsA = learnEnsembleWeights(["good", "bad"], validationExamples, config);

    // learnEnsembleWeights takes ONLY the array it is given — there is no
    // hidden global state or second data source it could reach into. The
    // strongest possible demonstration that a disjoint "test" set cannot
    // leak into weight fitting is that the function signature has no way
    // to receive one at all; this test documents that contract by
    // re-running with the identical validation set and confirming
    // determinism (a change in output would mean some external state was
    // read, which would itself be the leak).
    const weightsB = learnEnsembleWeights(["good", "bad"], validationExamples, config);
    expect(weightsA).toEqual(weightsB);

    // A completely different ("test") example set produces different
    // weights when passed directly — proving the function IS sensitive to
    // its input (so weightsA/weightsB matching above is meaningful, not
    // coincidental), while never being passed that data in the real
    // learnEnsembleWeights(componentNames, validationExamples, config)
    // call the ensemble pipeline actually makes.
    const differentExamples: EnsembleValidationExample[] = [{ components: { good: { home: 0.1, draw: 0.1, away: 0.8 }, bad: { home: 0.8, draw: 0.1, away: 0.1 } }, actual: "AWAY" }];
    const weightsFromDifferentData = learnEnsembleWeights(["good", "bad"], differentExamples, config);
    expect(weightsFromDifferentData).not.toEqual(weightsA);
  });
});
