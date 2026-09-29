import { generateId } from "@sport-os/shared";
import { describe, expect, it } from "vitest";
import type { TrainingExample } from "../dataset/types.js";
import type { Evaluation1x2Prediction } from "./metrics.js";
import { breakdownByCompetition, buildEvaluationSummary, dataQualityDistribution, missingFeatureRate } from "./summary.js";

function buildExample(fixtureId: string, competitionId: string, seasonId: string | undefined, featureValue: number | null, quality: "AVAILABLE" | "MISSING"): TrainingExample {
  return {
    fixtureId,
    competitionId,
    seasonId,
    kickoffTime: "2026-01-01T15:00:00Z",
    snapshotTime: "2026-01-01T14:00:00Z",
    features: { f1: { featureId: "f1", featureVersion: 1, fixtureId, value: featureValue, computedAt: "2026-01-01T14:00:00Z", snapshotTime: "2026-01-01T14:00:00Z", dataQuality: quality, sourceVersion: "test" } },
    target1x2: "HOME",
    targetTotalGoals: 2,
    targetBtts: false,
    datasetVersion: "eval-test-v1",
    builtAt: "2026-01-01T14:00:00Z",
  };
}

describe("missingFeatureRate / dataQualityDistribution", () => {
  it("computes the correct fraction of MISSING feature values", () => {
    const examples = [buildExample(generateId(), generateId(), undefined, 1, "AVAILABLE"), buildExample(generateId(), generateId(), undefined, null, "MISSING"), buildExample(generateId(), generateId(), undefined, null, "MISSING"), buildExample(generateId(), generateId(), undefined, 5, "AVAILABLE")];
    expect(missingFeatureRate(examples)).toBeCloseTo(0.5, 10);
  });

  it("counts every quality status, including zero-count ones", () => {
    const examples = [buildExample(generateId(), generateId(), undefined, 1, "AVAILABLE")];
    const distribution = dataQualityDistribution(examples);
    expect(distribution.AVAILABLE).toBe(1);
    expect(distribution.MISSING).toBe(0);
    expect(distribution.STALE).toBe(0);
  });
});

describe("breakdownByCompetition", () => {
  it("groups predictions by competitionId and computes per-group metrics", () => {
    const compA = generateId();
    const compB = generateId();
    const predictions: Evaluation1x2Prediction[] = [
      { fixtureId: generateId(), competitionId: compA, seasonId: undefined, predicted: { home: 1, draw: 0, away: 0 }, actual: "HOME" },
      { fixtureId: generateId(), competitionId: compA, seasonId: undefined, predicted: { home: 1, draw: 0, away: 0 }, actual: "AWAY" },
      { fixtureId: generateId(), competitionId: compB, seasonId: undefined, predicted: { home: 1, draw: 0, away: 0 }, actual: "HOME" },
    ];
    const breakdown = breakdownByCompetition(predictions);
    expect(breakdown[compA]!.sampleCount).toBe(2);
    expect(breakdown[compA]!.accuracy).toBeCloseTo(0.5, 10);
    expect(breakdown[compB]!.sampleCount).toBe(1);
    expect(breakdown[compB]!.accuracy).toBeCloseTo(1, 10);
  });
});

describe("buildEvaluationSummary", () => {
  it("assembles a complete summary — never just a bare accuracy number", () => {
    const competitionId = generateId();
    const fixtureId = generateId();
    const examples = [buildExample(fixtureId, competitionId, undefined, 1, "AVAILABLE")];
    const predictions: Evaluation1x2Prediction[] = [{ fixtureId, competitionId, seasonId: undefined, predicted: { home: 0.8, draw: 0.1, away: 0.1 }, actual: "HOME" }];

    const summary = buildEvaluationSummary({ datasetVersion: "eval-test-v1", modelVersion: "model-v1", predictions, examples, now: () => "2026-02-01T00:00:00Z" });

    expect(summary.sampleCount).toBe(1);
    expect(summary.accuracy).toBeCloseTo(1, 10);
    expect(summary.missingFeatureRate).toBe(0);
    expect(summary.byCompetition[competitionId]!.sampleCount).toBe(1);
    expect(summary.evaluatedAt).toBe("2026-02-01T00:00:00Z");
    expect(summary.calibrationBuckets.length).toBeGreaterThan(0);
  });
});
