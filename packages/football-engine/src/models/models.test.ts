import { generateId } from "@sport-os/shared";
import { describe, expect, it } from "vitest";
import type { TrainingExample } from "../dataset/types.js";
import { checkProbability1x2 } from "../probability/consistency.js";
import { GradientBoostedTreesModel } from "./gradient-boosted-trees.js";
import { RandomForestModel } from "./random-forest.js";
import { NeuralNetworkModel } from "./neural-network.js";
import type { FeatureQuality } from "../features/types.js";

/**
 * SYNTHETIC — a perfectly separable toy dataset (one feature, `signal`,
 * directly encodes the label) used only to validate that each model's
 * training mechanism actually learns something, not to claim any
 * real-world predictive accuracy.
 */
function buildSeparableExamples(count: number): TrainingExample[] {
  const examples: TrainingExample[] = [];
  for (let i = 0; i < count; i++) {
    const bucket = i % 3;
    const target = bucket === 0 ? "HOME" : bucket === 1 ? "DRAW" : "AWAY";
    const signal = bucket === 0 ? 10 : bucket === 1 ? 0 : -10;
    examples.push({
      fixtureId: generateId(),
      competitionId: generateId(),
      seasonId: undefined,
      kickoffTime: new Date(2026, 0, 1 + i).toISOString(),
      snapshotTime: new Date(2026, 0, 1 + i).toISOString(),
      features: { signal: { featureId: "signal", featureVersion: 1, fixtureId: generateId(), value: signal + (i % 2 === 0 ? 0.1 : -0.1), computedAt: "2026-01-01T00:00:00Z", snapshotTime: "2026-01-01T00:00:00Z", dataQuality: "AVAILABLE" as FeatureQuality, sourceVersion: "test" } },
      target1x2: target as TrainingExample["target1x2"],
      targetTotalGoals: 2,
      targetBtts: false,
      datasetVersion: "models-test-v1",
      builtAt: "2026-01-01T00:00:00Z",
    });
  }
  return examples;
}

const TRAIN_PARAMS_BASE = { trainingDatasetVersion: "models-test-v1", modelVersion: "v1", now: () => "2026-02-01T00:00:00Z" };

describe("RandomForestModel", () => {
  const examples = buildSeparableExamples(60);

  it("is deterministic given the same seed", () => {
    const config = { numTrees: 10, maxDepth: 3, minSamplesLeaf: 1 };
    const a = RandomForestModel.train({ ...TRAIN_PARAMS_BASE, examples, config, randomSeed: 7 });
    const b = RandomForestModel.train({ ...TRAIN_PARAMS_BASE, examples, config, randomSeed: 7 });
    expect(a.serialize()).toEqual(b.serialize());
  });

  it("learns the separable signal well above chance", () => {
    const model = RandomForestModel.train({ ...TRAIN_PARAMS_BASE, examples, config: { numTrees: 15, maxDepth: 4, minSamplesLeaf: 1 }, randomSeed: 1 });
    let correct = 0;
    for (const e of examples) {
      if (model.predict({ signal: e.features.signal!.value }) === e.target1x2) correct += 1;
    }
    expect(correct / examples.length).toBeGreaterThan(0.9);
  });

  it("always produces a valid Probability1x2", () => {
    const model = RandomForestModel.train({ ...TRAIN_PARAMS_BASE, examples, config: { numTrees: 5, maxDepth: 3, minSamplesLeaf: 1 }, randomSeed: 1 });
    for (const e of examples.slice(0, 10)) {
      expect(checkProbability1x2(model.predictProba({ signal: e.features.signal!.value })).ok).toBe(true);
    }
  });

  it("records complete, honest metadata (never an unversioned model)", () => {
    const model = RandomForestModel.train({ ...TRAIN_PARAMS_BASE, examples, config: { numTrees: 5, maxDepth: 3, minSamplesLeaf: 1 }, randomSeed: 42 });
    expect(model.metadata.modelFamily).toBe("random_forest");
    expect(model.metadata.randomSeed).toBe(42);
    expect(model.metadata.featureSchema).toEqual(["signal"]);
    expect(model.metadata.trainingDatasetVersion).toBe("models-test-v1");
    expect(model.metadata.evaluationReference).toBeUndefined();
  });

  it("round-trips through serialize/deserialize with identical predictions", () => {
    const model = RandomForestModel.train({ ...TRAIN_PARAMS_BASE, examples, config: { numTrees: 5, maxDepth: 3, minSamplesLeaf: 1 }, randomSeed: 1 });
    const restored = RandomForestModel.deserialize(model.serialize());
    const row = { signal: 10 };
    expect(restored.predictProba(row)).toEqual(model.predictProba(row));
  });

  it("handles a missing feature via the fitted imputer rather than throwing", () => {
    const model = RandomForestModel.train({ ...TRAIN_PARAMS_BASE, examples, config: { numTrees: 5, maxDepth: 3, minSamplesLeaf: 1 }, randomSeed: 1 });
    expect(() => model.predictProba({ signal: null })).not.toThrow();
  });
});

describe("GradientBoostedTreesModel", () => {
  const examples = buildSeparableExamples(60);

  it("is deterministic given the same seed", () => {
    const config = { numTrees: 15, maxDepth: 2, minSamplesLeaf: 1, learningRate: 0.3 };
    const a = GradientBoostedTreesModel.train({ ...TRAIN_PARAMS_BASE, examples, config, randomSeed: 7 });
    const b = GradientBoostedTreesModel.train({ ...TRAIN_PARAMS_BASE, examples, config, randomSeed: 7 });
    expect(a.serialize()).toEqual(b.serialize());
  });

  it("learns the separable signal well above chance", () => {
    const model = GradientBoostedTreesModel.train({ ...TRAIN_PARAMS_BASE, examples, config: { numTrees: 25, maxDepth: 3, minSamplesLeaf: 1, learningRate: 0.3 }, randomSeed: 1 });
    let correct = 0;
    for (const e of examples) {
      if (model.predict({ signal: e.features.signal!.value }) === e.target1x2) correct += 1;
    }
    expect(correct / examples.length).toBeGreaterThan(0.9);
  });

  it("always produces a valid Probability1x2", () => {
    const model = GradientBoostedTreesModel.train({ ...TRAIN_PARAMS_BASE, examples, config: { numTrees: 10, maxDepth: 2, minSamplesLeaf: 1, learningRate: 0.3 }, randomSeed: 1 });
    for (const e of examples.slice(0, 10)) {
      expect(checkProbability1x2(model.predictProba({ signal: e.features.signal!.value })).ok).toBe(true);
    }
  });
});

describe("NeuralNetworkModel", () => {
  const examples = buildSeparableExamples(60);

  it("is deterministic given the same seed", () => {
    const config = { hiddenUnits: 4, learningRate: 0.05, epochs: 30, l2: 0.0001 };
    const a = NeuralNetworkModel.train({ ...TRAIN_PARAMS_BASE, examples, config, randomSeed: 7 });
    const b = NeuralNetworkModel.train({ ...TRAIN_PARAMS_BASE, examples, config, randomSeed: 7 });
    expect(a.serialize()).toEqual(b.serialize());
  });

  it("learns the separable signal well above chance", () => {
    const model = NeuralNetworkModel.train({ ...TRAIN_PARAMS_BASE, examples, config: { hiddenUnits: 6, learningRate: 0.1, epochs: 60, l2: 0.0001 }, randomSeed: 1 });
    let correct = 0;
    for (const e of examples) {
      if (model.predict({ signal: e.features.signal!.value }) === e.target1x2) correct += 1;
    }
    expect(correct / examples.length).toBeGreaterThan(0.85);
  });

  it("always produces a valid Probability1x2", () => {
    const model = NeuralNetworkModel.train({ ...TRAIN_PARAMS_BASE, examples, config: { hiddenUnits: 4, learningRate: 0.05, epochs: 20, l2: 0.0001 }, randomSeed: 1 });
    for (const e of examples.slice(0, 10)) {
      expect(checkProbability1x2(model.predictProba({ signal: e.features.signal!.value })).ok).toBe(true);
    }
  });
});
