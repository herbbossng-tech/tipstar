import { describe, expect, it } from "vitest";
import { checkBinaryProbability, checkProbability1x2 } from "./probability/consistency.js";
import { buildPoissonScorelineDistribution } from "./statistical/poisson.js";
import { createSeededRng, runMonteCarloSimulation } from "./monte-carlo.js";

describe("createSeededRng", () => {
  it("is deterministic — the same seed produces the same sequence", () => {
    const a = createSeededRng(42);
    const b = createSeededRng(42);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("different seeds produce different sequences", () => {
    const a = createSeededRng(1);
    const b = createSeededRng(2);
    expect(a()).not.toBe(b());
  });

  it("always produces values in [0, 1)", () => {
    const rng = createSeededRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("runMonteCarloSimulation", () => {
  const distribution = buildPoissonScorelineDistribution(1.4, 1.1);

  it("is deterministic — the same distribution/seed/iterations always produces the same result", () => {
    const a = runMonteCarloSimulation(distribution, { iterations: 5000, seed: 123 });
    const b = runMonteCarloSimulation(distribution, { iterations: 5000, seed: 123 });
    expect(a).toEqual(b);
  });

  it("produces a valid, normalized 1X2 probability", () => {
    const result = runMonteCarloSimulation(distribution, { iterations: 5000, seed: 1 });
    expect(checkProbability1x2(result.probability1x2).ok).toBe(true);
  });

  it("produces valid BTTS and Over/Under probabilities", () => {
    const result = runMonteCarloSimulation(distribution, { iterations: 5000, seed: 1 });
    expect(checkBinaryProbability(result.btts, "BTTS").ok).toBe(true);
    for (const [threshold, prob] of Object.entries(result.overUnder)) {
      expect(checkBinaryProbability(prob, `Over/Under ${threshold}`).ok).toBe(true);
    }
  });

  it("rejects a non-positive iteration count", () => {
    expect(() => runMonteCarloSimulation(distribution, { iterations: 0, seed: 1 })).toThrow();
    expect(() => runMonteCarloSimulation(distribution, { iterations: -5, seed: 1 })).toThrow();
  });

  it("converges toward the exact analytic distribution as iterations grows (convergence sanity check)", () => {
    const analytic1x2 = { home: distribution.filter((s) => s.homeGoals > s.awayGoals).reduce((s, x) => s + x.probability, 0), draw: distribution.filter((s) => s.homeGoals === s.awayGoals).reduce((s, x) => s + x.probability, 0), away: distribution.filter((s) => s.homeGoals < s.awayGoals).reduce((s, x) => s + x.probability, 0) };

    const small = runMonteCarloSimulation(distribution, { iterations: 200, seed: 99 });
    const large = runMonteCarloSimulation(distribution, { iterations: 200_000, seed: 99 });

    const smallError = Math.abs(small.probability1x2.home - analytic1x2.home);
    const largeError = Math.abs(large.probability1x2.home - analytic1x2.home);
    expect(largeError).toBeLessThan(smallError);
    expect(largeError).toBeLessThan(0.01);
  });

  it("reports a shrinking standard error as iterations grows", () => {
    const small = runMonteCarloSimulation(distribution, { iterations: 100, seed: 5 });
    const large = runMonteCarloSimulation(distribution, { iterations: 100_000, seed: 5 });
    expect(large.homeWinStandardError).toBeLessThan(small.homeWinStandardError);
  });
});
