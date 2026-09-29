import { generateId } from "@sport-os/shared";
import { describe, expect, it } from "vitest";
import { accuracy1x2, accuracyBinary, brierScore1x2, brierScoreBinary, calibrationBuckets1x2, expectedCalibrationError1x2, logLoss1x2, logLossBinary, precisionRecallBinary, rocAucBinary, type Evaluation1x2Prediction, type EvaluationBinaryPrediction } from "./metrics.js";

describe("accuracy1x2 / logLoss1x2 / brierScore1x2 — known hand-computed values", () => {
  const competitionId = generateId();
  const predictions: Evaluation1x2Prediction[] = [
    { fixtureId: generateId(), competitionId, seasonId: undefined, predicted: { home: 0.8, draw: 0.1, away: 0.1 }, actual: "HOME" }, // correct, confident
    { fixtureId: generateId(), competitionId, seasonId: undefined, predicted: { home: 0.1, draw: 0.8, away: 0.1 }, actual: "AWAY" }, // wrong
    { fixtureId: generateId(), competitionId, seasonId: undefined, predicted: { home: 0.34, draw: 0.33, away: 0.33 }, actual: "HOME" }, // correct, low confidence
  ];

  it("accuracy1x2 counts argmax matches", () => {
    expect(accuracy1x2(predictions)).toBeCloseTo(2 / 3, 10);
  });

  it("logLoss1x2 matches the exact hand-computed mean -log(p_actual)", () => {
    const expected = (-Math.log(0.8) - Math.log(0.1) - Math.log(0.34)) / 3;
    expect(logLoss1x2(predictions)).toBeCloseTo(expected, 10);
  });

  it("brierScore1x2 matches the exact hand-computed multiclass Brier score", () => {
    const b1 = (0.8 - 1) ** 2 + (0.1 - 0) ** 2 + (0.1 - 0) ** 2;
    const b2 = (0.1 - 0) ** 2 + (0.8 - 0) ** 2 + (0.1 - 1) ** 2;
    const b3 = (0.34 - 1) ** 2 + (0.33 - 0) ** 2 + (0.33 - 0) ** 2;
    expect(brierScore1x2(predictions)).toBeCloseTo((b1 + b2 + b3) / 3, 10);
  });

  it("a perfect predictor has logLoss approaching 0 and Brier exactly 0", () => {
    const perfect: Evaluation1x2Prediction[] = [{ fixtureId: generateId(), competitionId, seasonId: undefined, predicted: { home: 1, draw: 0, away: 0 }, actual: "HOME" }];
    expect(brierScore1x2(perfect)).toBeCloseTo(0, 10);
    expect(logLoss1x2(perfect)).toBeCloseTo(0, 6);
  });
});

describe("calibrationBuckets1x2 / expectedCalibrationError1x2", () => {
  it("a perfectly calibrated model (confidence always matches accuracy) has ECE ~ 0", () => {
    const competitionId = generateId();
    // 10 predictions all at 70% confidence in the predicted class, 7 of which are correct — confidence (0.7) matches empirical accuracy (0.7) exactly.
    const predictions: Evaluation1x2Prediction[] = Array.from({ length: 10 }, (_, i) => ({
      fixtureId: generateId(),
      competitionId,
      seasonId: undefined,
      predicted: { home: 0.7, draw: 0.15, away: 0.15 },
      actual: i < 7 ? "HOME" : "AWAY",
    }));
    expect(expectedCalibrationError1x2(predictions, 10)).toBeCloseTo(0, 5);
  });

  it("an overconfident model has a materially positive ECE", () => {
    const competitionId = generateId();
    const predictions: Evaluation1x2Prediction[] = Array.from({ length: 10 }, (_, i) => ({
      fixtureId: generateId(),
      competitionId,
      seasonId: undefined,
      predicted: { home: 0.95, draw: 0.025, away: 0.025 },
      actual: i < 5 ? "HOME" : "AWAY", // only 50% accurate despite 95% claimed confidence
    }));
    expect(expectedCalibrationError1x2(predictions, 10)).toBeGreaterThan(0.3);
  });

  it("buckets partition every prediction exactly once", () => {
    const competitionId = generateId();
    const predictions: Evaluation1x2Prediction[] = Array.from({ length: 25 }, () => ({ fixtureId: generateId(), competitionId, seasonId: undefined, predicted: { home: Math.random() * 0.5 + 0.34, draw: 0.33, away: 0.33 }, actual: "HOME" as const }));
    const buckets = calibrationBuckets1x2(predictions, 5);
    expect(buckets.reduce((s, b) => s + b.count, 0)).toBe(25);
  });
});

describe("binary metrics", () => {
  const predictions: EvaluationBinaryPrediction[] = [
    { fixtureId: generateId(), predicted: { yes: 0.9, no: 0.1 }, actual: true },
    { fixtureId: generateId(), predicted: { yes: 0.8, no: 0.2 }, actual: true },
    { fixtureId: generateId(), predicted: { yes: 0.3, no: 0.7 }, actual: false },
    { fixtureId: generateId(), predicted: { yes: 0.6, no: 0.4 }, actual: false }, // a false positive at threshold 0.5
  ];

  it("accuracyBinary at the default 0.5 threshold", () => {
    expect(accuracyBinary(predictions)).toBeCloseTo(3 / 4, 10);
  });

  it("precisionRecallBinary matches hand-computed values", () => {
    // predicted yes: indices 0,1,3 (0.9,0.8,0.6 >= 0.5); true positives: 0,1; false positive: 3.
    const { precision, recall } = precisionRecallBinary(predictions);
    expect(precision).toBeCloseTo(2 / 3, 10);
    expect(recall).toBeCloseTo(2 / 2, 10);
  });

  it("logLossBinary and brierScoreBinary are finite and non-negative", () => {
    expect(logLossBinary(predictions)).toBeGreaterThan(0);
    expect(brierScoreBinary(predictions)).toBeGreaterThanOrEqual(0);
  });

  it("rocAucBinary is exactly 1.0 for perfect separation", () => {
    const perfect: EvaluationBinaryPrediction[] = [
      { fixtureId: generateId(), predicted: { yes: 0.9, no: 0.1 }, actual: true },
      { fixtureId: generateId(), predicted: { yes: 0.8, no: 0.2 }, actual: true },
      { fixtureId: generateId(), predicted: { yes: 0.3, no: 0.7 }, actual: false },
      { fixtureId: generateId(), predicted: { yes: 0.1, no: 0.9 }, actual: false },
    ];
    expect(rocAucBinary(perfect)).toBeCloseTo(1, 10);
  });

  it("rocAucBinary is exactly 0.5 for a random/uninformative predictor with symmetric scores", () => {
    const random: EvaluationBinaryPrediction[] = [
      { fixtureId: generateId(), predicted: { yes: 0.5, no: 0.5 }, actual: true },
      { fixtureId: generateId(), predicted: { yes: 0.5, no: 0.5 }, actual: false },
      { fixtureId: generateId(), predicted: { yes: 0.5, no: 0.5 }, actual: true },
      { fixtureId: generateId(), predicted: { yes: 0.5, no: 0.5 }, actual: false },
    ];
    expect(rocAucBinary(random)).toBeCloseTo(0.5, 10);
  });

  it("rocAucBinary is NaN (not a fabricated 0.5) when only one class is present", () => {
    const onlyPositive: EvaluationBinaryPrediction[] = [{ fixtureId: generateId(), predicted: { yes: 0.9, no: 0.1 }, actual: true }];
    expect(Number.isNaN(rocAucBinary(onlyPositive))).toBe(true);
  });
});
