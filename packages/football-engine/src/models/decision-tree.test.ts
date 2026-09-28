import { describe, expect, it } from "vitest";
import { createSeededRng } from "../monte-carlo.js";
import { predictRegressionTree, trainRegressionTree } from "./decision-tree.js";

describe("trainRegressionTree / predictRegressionTree", () => {
  it("perfectly separates a trivial single-feature threshold rule", () => {
    // y = 0 if x < 5, else 10 — a tree should find the exact split.
    const X = [[1], [2], [3], [4], [6], [7], [8], [9]];
    const y = [0, 0, 0, 0, 10, 10, 10, 10];
    const rng = createSeededRng(1);
    const tree = trainRegressionTree(X, y, 1, { maxDepth: 4, minSamplesLeaf: 1 }, rng);

    expect(predictRegressionTree(tree, [1])).toBeCloseTo(0, 5);
    expect(predictRegressionTree(tree, [4])).toBeCloseTo(0, 5);
    expect(predictRegressionTree(tree, [6])).toBeCloseTo(10, 5);
    expect(predictRegressionTree(tree, [9])).toBeCloseTo(10, 5);
  });

  it("a maxDepth of 0 always predicts the training mean (a single leaf)", () => {
    const X = [[1], [2], [3]];
    const y = [0, 5, 10];
    const rng = createSeededRng(1);
    const tree = trainRegressionTree(X, y, 1, { maxDepth: 0, minSamplesLeaf: 1 }, rng);
    expect(tree.isLeaf).toBe(true);
    expect(predictRegressionTree(tree, [1])).toBeCloseTo(5, 5);
    expect(predictRegressionTree(tree, [100])).toBeCloseTo(5, 5);
  });

  it("respects minSamplesLeaf — never splits into a leaf smaller than the minimum", () => {
    const X = [[1], [2], [3], [4]];
    const y = [0, 0, 10, 10];
    const rng = createSeededRng(1);
    const tree = trainRegressionTree(X, y, 1, { maxDepth: 5, minSamplesLeaf: 3 }, rng);
    // With only 4 samples and minSamplesLeaf=3, no split can produce two valid children — must stay a single leaf.
    expect(tree.isLeaf).toBe(true);
  });

  it("is deterministic given the same seeded RNG (relevant once maxFeatures triggers random subsampling)", () => {
    const X = [[1, 5], [2, 4], [3, 3], [8, 2], [9, 1], [10, 0]];
    const y = [0, 0, 0, 10, 10, 10];
    const treeA = trainRegressionTree(X, y, 2, { maxDepth: 4, minSamplesLeaf: 1, maxFeatures: 1 }, createSeededRng(42));
    const treeB = trainRegressionTree(X, y, 2, { maxDepth: 4, minSamplesLeaf: 1, maxFeatures: 1 }, createSeededRng(42));
    expect(treeA).toEqual(treeB);
  });
});
