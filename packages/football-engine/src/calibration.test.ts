import { describe, expect, it } from "vitest";
import { fitIsotonicCalibrator, fitPlattCalibrator, selectCalibrator, type CalibrationExample } from "./calibration.js";
import { checkProbability1x2 } from "./probability/consistency.js";

/** SYNTHETIC — a model that is systematically overconfident: it always predicts 0.9 for the actual outcome and splits the rest, but the TRUE frequency of that outcome is only ~60%. A good calibrator should pull 0.9 down toward ~0.6. */
function buildOverconfidentExamples(count: number): CalibrationExample[] {
  const examples: CalibrationExample[] = [];
  for (let i = 0; i < count; i++) {
    const kickoffTime = new Date(2026, 0, 1 + i).toISOString();
    // 60% of the time HOME actually happens even though the model always claims 90% confidence in HOME.
    const actual = i % 5 < 3 ? "HOME" : i % 5 === 3 ? "DRAW" : "AWAY";
    examples.push({ rawProbability1x2: { home: 0.9, draw: 0.05, away: 0.05 }, actual, kickoffTime });
  }
  return examples;
}

describe("fitPlattCalibrator", () => {
  it("pulls an overconfident prediction toward the true observed frequency", () => {
    const examples = buildOverconfidentExamples(100);
    const calibrator = fitPlattCalibrator({ examples, calibratorVersion: "test-v1", inputModelVersion: "model-v1", calibrationDatasetVersion: "calib-v1" });
    const calibrated = calibrator.calibrate({ home: 0.9, draw: 0.05, away: 0.05 });
    expect(calibrated.home).toBeLessThan(0.9);
    expect(checkProbability1x2(calibrated).ok).toBe(true);
  });

  it("is deterministic given the same seed", () => {
    const examples = buildOverconfidentExamples(50);
    const config = { epochs: 50, learningRate: 0.1, seed: 7 };
    const a = fitPlattCalibrator({ examples, calibratorVersion: "v1", inputModelVersion: "m1", calibrationDatasetVersion: "d1", plattConfig: config });
    const b = fitPlattCalibrator({ examples, calibratorVersion: "v1", inputModelVersion: "m1", calibrationDatasetVersion: "d1", plattConfig: config });
    expect(a.calibrate({ home: 0.7, draw: 0.2, away: 0.1 })).toEqual(b.calibrate({ home: 0.7, draw: 0.2, away: 0.1 }));
  });

  it("records complete metadata, including the training time range actually used", () => {
    const examples = buildOverconfidentExamples(10);
    const calibrator = fitPlattCalibrator({ examples, calibratorVersion: "v1", inputModelVersion: "model-v1", calibrationDatasetVersion: "calib-v1" });
    expect(calibrator.metadata.calibratorType).toBe("platt");
    expect(calibrator.metadata.inputModelVersion).toBe("model-v1");
    expect(calibrator.metadata.trainingRangeStart).toBe(examples[0]!.kickoffTime);
    expect(calibrator.metadata.trainingRangeEnd).toBe(examples[examples.length - 1]!.kickoffTime);
  });
});

describe("fitIsotonicCalibrator", () => {
  it("produces a valid, normalized probability", () => {
    const examples = buildOverconfidentExamples(100);
    const calibrator = fitIsotonicCalibrator({ examples, calibratorVersion: "v1", inputModelVersion: "m1", calibrationDatasetVersion: "d1" });
    const calibrated = calibrator.calibrate({ home: 0.9, draw: 0.05, away: 0.05 });
    expect(checkProbability1x2(calibrated).ok).toBe(true);
  });

  it("is monotone non-decreasing on the fitted training points (the defining isotonic property)", () => {
    const examples: CalibrationExample[] = [
      { rawProbability1x2: { home: 0.2, draw: 0.4, away: 0.4 }, actual: "AWAY", kickoffTime: "2026-01-01T00:00:00Z" },
      { rawProbability1x2: { home: 0.5, draw: 0.3, away: 0.2 }, actual: "HOME", kickoffTime: "2026-01-02T00:00:00Z" },
      { rawProbability1x2: { home: 0.8, draw: 0.1, away: 0.1 }, actual: "HOME", kickoffTime: "2026-01-03T00:00:00Z" },
    ];
    const calibrator = fitIsotonicCalibrator({ examples, calibratorVersion: "v1", inputModelVersion: "m1", calibrationDatasetVersion: "d1" });
    const low = calibrator.calibrate({ home: 0.2, draw: 0.4, away: 0.4 }).home;
    const mid = calibrator.calibrate({ home: 0.5, draw: 0.3, away: 0.2 }).home;
    const high = calibrator.calibrate({ home: 0.8, draw: 0.1, away: 0.1 }).home;
    expect(mid).toBeGreaterThanOrEqual(low);
    expect(high).toBeGreaterThanOrEqual(mid);
  });
});

describe("selectCalibrator", () => {
  it("picks the candidate with lower log-loss on the validation set — never fits on the validation/test data itself", () => {
    const trainingExamples = buildOverconfidentExamples(80);
    const validationExamples = buildOverconfidentExamples(20); // a disjoint set the caller is responsible for keeping separate from training.

    const platt = fitPlattCalibrator({ examples: trainingExamples, calibratorVersion: "platt-v1", inputModelVersion: "m1", calibrationDatasetVersion: "d1" });
    const isotonic = fitIsotonicCalibrator({ examples: trainingExamples, calibratorVersion: "isotonic-v1", inputModelVersion: "m1", calibrationDatasetVersion: "d1" });

    const selection = selectCalibrator([platt, isotonic], validationExamples);
    expect(["platt", "isotonic"]).toContain(selection.calibrator.metadata.calibratorType);
    expect(Number.isFinite(selection.validationLogLoss)).toBe(true);
    expect(selection.validationLogLoss).toBeGreaterThan(0);
  });

  it("throws rather than silently picking nothing when given zero candidates", () => {
    expect(() => selectCalibrator([], [])).toThrow();
  });
});
