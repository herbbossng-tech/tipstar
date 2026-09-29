/**
 * A real CART regression tree (variance-reduction split criterion) —
 * the shared base learner behind both Random Forest (models/random-
 * forest.ts) and Gradient Boosted Trees (models/gradient-boosted-
 * trees.ts). Both classification ensembles are built from this one
 * regression-tree implementation via one-vs-rest numeric targets (see
 * each file's own comment) rather than duplicating a second, subtly
 * different tree implementation — the same "one real primitive, reused"
 * reasoning as features/history.ts.
 */

export interface RegressionTreeNode {
  readonly isLeaf: boolean;
  readonly prediction: number;
  readonly featureIndex?: number;
  readonly threshold?: number;
  readonly left?: RegressionTreeNode;
  readonly right?: RegressionTreeNode;
}

export interface RegressionTreeConfig {
  readonly maxDepth: number;
  readonly minSamplesLeaf: number;
  /** Random feature subsampling per split (Random Forest's decorrelation mechanism) — undefined uses every feature at every split (the usual choice for gradient boosting). */
  readonly maxFeatures?: number;
}

function mean(values: readonly number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function variance(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  return values.reduce((s, v) => s + (v - m) * (v - m), 0) / values.length;
}

/** Fisher-Yates shuffle with an injected RNG — used only to pick a random feature subset per split, never anywhere data ordering matters for leakage. */
function shuffledIndices(count: number, rng: () => number): number[] {
  const indices = Array.from({ length: count }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j]!, indices[i]!];
  }
  return indices;
}

interface SplitCandidate {
  readonly featureIndex: number;
  readonly threshold: number;
  readonly leftIndices: number[];
  readonly rightIndices: number[];
  readonly weightedVariance: number;
}

function findBestSplit(X: readonly (readonly number[])[], y: readonly number[], sampleIndices: readonly number[], featureCount: number, config: RegressionTreeConfig, rng: () => number): SplitCandidate | undefined {
  const candidateFeatures = config.maxFeatures !== undefined && config.maxFeatures < featureCount ? shuffledIndices(featureCount, rng).slice(0, config.maxFeatures) : Array.from({ length: featureCount }, (_, i) => i);

  let best: SplitCandidate | undefined;

  for (const featureIndex of candidateFeatures) {
    const sorted = [...sampleIndices].sort((a, b) => X[a]![featureIndex]! - X[b]![featureIndex]!);
    const values = sorted.map((i) => X[i]![featureIndex]!);

    for (let i = 1; i < sorted.length; i++) {
      if (values[i] === values[i - 1]) continue; // only split between distinct values
      const threshold = (values[i]! + values[i - 1]!) / 2;
      const leftIndices = sorted.slice(0, i);
      const rightIndices = sorted.slice(i);
      if (leftIndices.length < config.minSamplesLeaf || rightIndices.length < config.minSamplesLeaf) continue;

      const leftY = leftIndices.map((idx) => y[idx]!);
      const rightY = rightIndices.map((idx) => y[idx]!);
      const weightedVariance = (leftY.length * variance(leftY) + rightY.length * variance(rightY)) / sampleIndices.length;

      if (!best || weightedVariance < best.weightedVariance) {
        best = { featureIndex, threshold, leftIndices, rightIndices, weightedVariance };
      }
    }
  }

  return best;
}

function buildNode(X: readonly (readonly number[])[], y: readonly number[], sampleIndices: readonly number[], featureCount: number, config: RegressionTreeConfig, depth: number, rng: () => number): RegressionTreeNode {
  const targetValues = sampleIndices.map((i) => y[i]!);
  const leafPrediction = mean(targetValues);

  if (depth >= config.maxDepth || sampleIndices.length < 2 * config.minSamplesLeaf || variance(targetValues) === 0) {
    return { isLeaf: true, prediction: leafPrediction };
  }

  const split = findBestSplit(X, y, sampleIndices, featureCount, config, rng);
  if (!split) {
    return { isLeaf: true, prediction: leafPrediction };
  }

  return {
    isLeaf: false,
    prediction: leafPrediction,
    featureIndex: split.featureIndex,
    threshold: split.threshold,
    left: buildNode(X, y, split.leftIndices, featureCount, config, depth + 1, rng),
    right: buildNode(X, y, split.rightIndices, featureCount, config, depth + 1, rng),
  };
}

export function trainRegressionTree(X: readonly (readonly number[])[], y: readonly number[], featureCount: number, config: RegressionTreeConfig, rng: () => number): RegressionTreeNode {
  const allIndices = Array.from({ length: X.length }, (_, i) => i);
  return buildNode(X, y, allIndices, featureCount, config, 0, rng);
}

export function predictRegressionTree(node: RegressionTreeNode, x: readonly number[]): number {
  let current = node;
  while (!current.isLeaf) {
    const goLeft = x[current.featureIndex!]! <= current.threshold!;
    current = goLeft ? current.left! : current.right!;
  }
  return current.prediction;
}
