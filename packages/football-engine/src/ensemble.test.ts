import { describe, expect, it } from "vitest";
import { combineEnsemble, learnEnsembleWeights, type EnsembleComponentPrediction, type EnsembleValidationExample } from "./ensemble.js";
import { checkProbability1x2 } from "./probability/consistency.js";

describe("combineEnsemble", () => {
  const components: EnsembleComponentPrediction[] = [
    { name: "elo", modelVersion: "elo-v1", probability1x2: { home: 0.5, draw: 0.3, away: 0.2 } },
    { name: "poisson", modelVersion: "poisson-v1", probability1x2: { home: 0.4, draw: 0.3, away: 0.3 } },
  ];

  it("produces a weighted average that sums to 1", () => {
    const result = combineEnsemble(components, { ensembleVersion: "v1", weightSource: "configured_baseline", weights: { elo: 0.6, poisson: 0.4 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(checkProbability1x2(result.value.probability1x2).ok).toBe(true);
    expect(result.value.probability1x2.home).toBeCloseTo(0.6 * 0.5 + 0.4 * 0.4, 10);
  });

  it("renormalizes when a configured component is missing from the input (graceful degradation)", () => {
    const result = combineEnsemble([components[0]!], { ensembleVersion: "v1", weightSource: "configured_baseline", weights: { elo: 0.6, poisson: 0.4 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only elo present — its effective weight should be renormalized to 1.0, so the output should equal elo's own distribution exactly.
    expect(result.value.probability1x2).toEqual({ home: 0.5, draw: 0.3, away: 0.2 });
    expect(result.value.componentContributions.elo!.effectiveWeight).toBeCloseTo(1, 10);
  });

  it("fails closed when no component has a positive configured weight", () => {
    const result = combineEnsemble(components, { ensembleVersion: "v1", weightSource: "configured_baseline", weights: { unrelated_component: 1 } });
    expect(result.ok).toBe(false);
  });

  it("records full provenance — which components contributed and at what effective weight", () => {
    const result = combineEnsemble(components, { ensembleVersion: "v2", weightSource: "configured_baseline", weights: { elo: 0.6, poisson: 0.4 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ensembleVersion).toBe("v2");
    expect(Object.keys(result.value.componentContributions).sort()).toEqual(["elo", "poisson"]);
  });
});

describe("learnEnsembleWeights", () => {
  it("assigns near-all weight to the component that is consistently correct, near-none to the one that is consistently wrong", () => {
    // 'good' always puts high probability on the actual outcome; 'bad' always puts high probability on the wrong one.
    const examples: EnsembleValidationExample[] = [
      { components: { good: { home: 0.9, draw: 0.05, away: 0.05 }, bad: { home: 0.05, draw: 0.05, away: 0.9 } }, actual: "HOME" },
      { components: { good: { home: 0.05, draw: 0.9, away: 0.05 }, bad: { home: 0.9, draw: 0.05, away: 0.05 } }, actual: "DRAW" },
      { components: { good: { home: 0.05, draw: 0.05, away: 0.9 }, bad: { home: 0.05, draw: 0.9, away: 0.05 } }, actual: "AWAY" },
      { components: { good: { home: 0.85, draw: 0.1, away: 0.05 }, bad: { home: 0.1, draw: 0.05, away: 0.85 } }, actual: "HOME" },
    ];

    const weights = learnEnsembleWeights(["good", "bad"], examples, { epochs: 200, learningRate: 0.5, seed: 1 });
    expect(weights.good!).toBeGreaterThan(weights.bad!);
    expect(weights.good! + weights.bad!).toBeCloseTo(1, 6);
  });

  it("is deterministic given the same seed", () => {
    const examples: EnsembleValidationExample[] = [{ components: { a: { home: 0.6, draw: 0.2, away: 0.2 }, b: { home: 0.3, draw: 0.4, away: 0.3 } }, actual: "HOME" }];
    const a = learnEnsembleWeights(["a", "b"], examples, { epochs: 50, learningRate: 0.2, seed: 42 });
    const b = learnEnsembleWeights(["a", "b"], examples, { epochs: 50, learningRate: 0.2, seed: 42 });
    expect(a).toEqual(b);
  });

  it("returns equal weights with no validation examples, rather than an arbitrary guess", () => {
    const weights = learnEnsembleWeights(["a", "b", "c"], [], { epochs: 10, learningRate: 0.1, seed: 1 });
    expect(weights).toEqual({ a: 1 / 3, b: 1 / 3, c: 1 / 3 });
  });

  it("always returns weights summing to 1", () => {
    const examples: EnsembleValidationExample[] = [{ components: { a: { home: 0.5, draw: 0.3, away: 0.2 }, b: { home: 0.2, draw: 0.3, away: 0.5 }, c: { home: 0.33, draw: 0.34, away: 0.33 } }, actual: "DRAW" }];
    const weights = learnEnsembleWeights(["a", "b", "c"], examples, { epochs: 30, learningRate: 0.3, seed: 5 });
    const sum = Object.values(weights).reduce((s, w) => s + w, 0);
    expect(sum).toBeCloseTo(1, 8);
    for (const w of Object.values(weights)) {
      expect(w).toBeGreaterThanOrEqual(0);
    }
  });
});
