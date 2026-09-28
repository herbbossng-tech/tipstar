import { generateId } from "@sport-os/shared";
import { describe, expect, it } from "vitest";
import { buildPredictionOutput, computeFairOdds } from "./output-contract.js";

describe("computeFairOdds", () => {
  it("computes 1/probability for a valid positive probability", () => {
    expect(computeFairOdds(0.5)).toBe(2);
    expect(computeFairOdds(0.25)).toBe(4);
  });
  it("is undefined for probability 0", () => {
    expect(computeFairOdds(0)).toBeUndefined();
  });
  it("is undefined for a negative or NaN probability (never a fabricated fair odds)", () => {
    expect(computeFairOdds(-0.1)).toBeUndefined();
    expect(computeFairOdds(NaN)).toBeUndefined();
  });
});

describe("buildPredictionOutput", () => {
  const baseParams = {
    fixtureId: generateId(),
    predictionTimestamp: "2026-01-10T18:00:00Z",
    snapshotTime: "2026-01-10T18:00:00Z",
    modelVersion: "elo-v1",
    probability1x2: { home: 0.5, draw: 0.3, away: 0.2 },
    dataQuality: "AVAILABLE" as const,
    featureVersions: { elo_rating_diff: 1 },
    sourceVersion: "test_fixture_provider",
  };

  it("builds a valid output with correct 1X2 markets and fair odds", () => {
    const result = buildPredictionOutput(baseParams);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.homeWinProbability).toBe(0.5);
    const homeMarket = result.value.markets.find((m) => m.market === "1X2" && m.selection === "HOME")!;
    expect(homeMarket.fairOdds).toBe(2);
  });

  it("fails closed for an invalid (non-summing-to-1) probability distribution", () => {
    const result = buildPredictionOutput({ ...baseParams, probability1x2: { home: 0.9, draw: 0.9, away: 0.9 } });
    expect(result.ok).toBe(false);
  });

  it("includes additional markets alongside 1X2", () => {
    const result = buildPredictionOutput({ ...baseParams, additionalMarkets: [{ market: "BTTS", selection: "YES", probability: 0.55 }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const btts = result.value.markets.find((m) => m.market === "BTTS")!;
    expect(btts.probability).toBe(0.55);
    expect(btts.fairOdds).toBeCloseTo(1 / 0.55, 10);
  });

  it("rejects an invalid additional market probability", () => {
    const result = buildPredictionOutput({ ...baseParams, additionalMarkets: [{ market: "BTTS", selection: "YES", probability: 1.5 }] });
    expect(result.ok).toBe(false);
  });

  it("never claims certainty — the uncertainty note is present and fixed", () => {
    const result = buildPredictionOutput(baseParams);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.uncertainty.note).toContain("not a guarantee");
  });

  it("carries ensemble provenance through when supplied", () => {
    const result = buildPredictionOutput({ ...baseParams, ensembleVersion: "ensemble-v1", componentContributions: { elo: { modelVersion: "elo-v1", effectiveWeight: 0.6 }, poisson: { modelVersion: "poisson-v1", effectiveWeight: 0.4 } } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ensembleVersion).toBe("ensemble-v1");
    expect(result.value.provenance.componentContributions?.elo?.effectiveWeight).toBe(0.6);
  });
});
