import { isErr, isOk } from "@sport-os/shared";
import { describe, expect, it } from "vitest";
import { checkBinaryProbability, checkOverUnderCoherence, checkProbability1x2, checkScorelineDistribution } from "./consistency.js";
import { derive1x2FromScoreline, deriveBttsFromScoreline, deriveOverUnderFromScoreline, totalMass } from "./scoreline.js";
import type { ScorelineDistribution } from "./types.js";

describe("checkProbability1x2", () => {
  it("accepts a well-formed distribution summing to 1", () => {
    expect(isOk(checkProbability1x2({ home: 0.5, draw: 0.3, away: 0.2 }))).toBe(true);
  });
  it("rejects a negative probability", () => {
    expect(isErr(checkProbability1x2({ home: -0.1, draw: 0.6, away: 0.5 }))).toBe(true);
  });
  it("rejects a probability greater than 1", () => {
    expect(isErr(checkProbability1x2({ home: 1.5, draw: 0, away: 0 }))).toBe(true);
  });
  it("rejects NaN", () => {
    expect(isErr(checkProbability1x2({ home: NaN, draw: 0.5, away: 0.5 }))).toBe(true);
  });
  it("rejects Infinity", () => {
    expect(isErr(checkProbability1x2({ home: Infinity, draw: 0, away: 0 }))).toBe(true);
  });
  it("rejects a distribution that does not sum to 1", () => {
    expect(isErr(checkProbability1x2({ home: 0.5, draw: 0.5, away: 0.5 }))).toBe(true);
  });
  it("tolerates genuine floating-point rounding", () => {
    expect(isOk(checkProbability1x2({ home: 0.1 + 0.2, draw: 0.3, away: 1 - (0.1 + 0.2) - 0.3 }))).toBe(true);
  });
});

describe("checkBinaryProbability", () => {
  it("accepts yes+no summing to 1", () => {
    expect(isOk(checkBinaryProbability({ yes: 0.6, no: 0.4 }, "BTTS"))).toBe(true);
  });
  it("rejects a sum that isn't 1", () => {
    expect(isErr(checkBinaryProbability({ yes: 0.6, no: 0.6 }, "BTTS"))).toBe(true);
  });
});

describe("checkScorelineDistribution", () => {
  it("rejects an empty distribution", () => {
    expect(isErr(checkScorelineDistribution([]))).toBe(true);
  });
  it("rejects a negative goal count", () => {
    expect(isErr(checkScorelineDistribution([{ homeGoals: -1, awayGoals: 0, probability: 1 }]))).toBe(true);
  });
  it("rejects a non-integer goal count", () => {
    expect(isErr(checkScorelineDistribution([{ homeGoals: 1.5, awayGoals: 0, probability: 1 }]))).toBe(true);
  });
  it("rejects a distribution not summing to 1", () => {
    expect(isErr(checkScorelineDistribution([{ homeGoals: 1, awayGoals: 0, probability: 0.5 }]))).toBe(true);
  });
  it("accepts a well-formed distribution", () => {
    expect(isOk(checkScorelineDistribution([{ homeGoals: 1, awayGoals: 0, probability: 0.6 }, { homeGoals: 0, awayGoals: 0, probability: 0.4 }]))).toBe(true);
  });
});

describe("checkOverUnderCoherence", () => {
  it("accepts a monotonically decreasing Over sequence", () => {
    expect(isOk(checkOverUnderCoherence(0.6, 0.4, 1.5, 2.5))).toBe(true);
  });
  it("rejects a higher threshold with a HIGHER probability than a lower one", () => {
    expect(isErr(checkOverUnderCoherence(0.4, 0.6, 1.5, 2.5))).toBe(true);
  });
});

describe("scoreline derivation — consistent markets from one shared distribution", () => {
  const distribution: ScorelineDistribution = [
    { homeGoals: 0, awayGoals: 0, probability: 0.2 },
    { homeGoals: 1, awayGoals: 0, probability: 0.25 },
    { homeGoals: 2, awayGoals: 1, probability: 0.2 },
    { homeGoals: 1, awayGoals: 1, probability: 0.15 },
    { homeGoals: 0, awayGoals: 1, probability: 0.1 },
    { homeGoals: 1, awayGoals: 2, probability: 0.1 },
  ];

  it("sums to 1 (a well-formed test fixture)", () => {
    expect(totalMass(distribution)).toBeCloseTo(1, 10);
  });

  it("derives a valid 1X2 distribution", () => {
    const result = derive1x2FromScoreline(distribution);
    expect(isOk(checkProbability1x2(result))).toBe(true);
    // home wins: (1,0)=.25 + (2,1)=.2 = .45; draws: (0,0)=.2 + (1,1)=.15 = .35; away wins: (0,1)=.1 + (1,2)=.1 = .2
    expect(result.home).toBeCloseTo(0.45, 10);
    expect(result.draw).toBeCloseTo(0.35, 10);
    expect(result.away).toBeCloseTo(0.2, 10);
  });

  it("derives a valid BTTS distribution", () => {
    const result = deriveBttsFromScoreline(distribution);
    expect(isOk(checkBinaryProbability(result, "BTTS"))).toBe(true);
    // Both score: (2,1)=.2, (1,1)=.15, (1,2)=.1 => yes = .45
    expect(result.yes).toBeCloseTo(0.45, 10);
  });

  it("derives Over/Under thresholds that are monotonically coherent", () => {
    const over05 = deriveOverUnderFromScoreline(distribution, 0.5);
    const over25 = deriveOverUnderFromScoreline(distribution, 2.5);
    expect(isOk(checkOverUnderCoherence(over05.yes, over25.yes, 0.5, 2.5))).toBe(true);
  });
});
