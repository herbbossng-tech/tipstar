import type { ISODateString } from "@sport-os/shared";
import type { Target1X2 } from "../dataset/types.js";
import { createSeededRng } from "../monte-carlo.js";
import type { Probability1x2 } from "../probability/types.js";
import { predictRegressionTree, trainRegressionTree, type RegressionTreeNode } from "./decision-tree.js";
import { applyImputer, collectFeatureSchema, fitMedianImputer, toFeatureRow, type Imputer } from "./encode.js";
import { normalizeOneVsRest } from "./one-vs-rest.js";
import { argmax1x2, type FeatureRow, type MlModel, type ModelMetadata, type SerializedModel, type TrainMlModelParams } from "./types.js";

/**
 * Random Forest — Section 05 §11/§28. Bagged ensemble of the CART
 * regression trees in decision-tree.ts, one independent forest per
 * outcome class (one-vs-rest: HOME-vs-rest, DRAW-vs-rest, AWAY-vs-rest),
 * each tree trained on a bootstrap resample with random feature
 * subsampling per split — the two decorrelation mechanisms that make a
 * random forest more than "many copies of the same tree".
 */

export interface RandomForestConfig {
  readonly numTrees: number;
  readonly maxDepth: number;
  readonly minSamplesLeaf: number;
  /** Features considered at each split — undefined uses every feature (turns bagging alone into the only decorrelation source). */
  readonly maxFeatures?: number;
}

interface OneVsRestForest {
  readonly trees: readonly RegressionTreeNode[];
}

function trainForestForClass(X: readonly (readonly number[])[], y: readonly number[], featureCount: number, config: RandomForestConfig, rng: () => number): OneVsRestForest {
  const trees: RegressionTreeNode[] = [];
  for (let t = 0; t < config.numTrees; t++) {
    const bootstrapIndices = Array.from({ length: X.length }, () => Math.floor(rng() * X.length));
    const Xb = bootstrapIndices.map((i) => X[i]!);
    const yb = bootstrapIndices.map((i) => y[i]!);
    trees.push(trainRegressionTree(Xb, yb, featureCount, config.maxFeatures !== undefined ? { maxDepth: config.maxDepth, minSamplesLeaf: config.minSamplesLeaf, maxFeatures: config.maxFeatures } : { maxDepth: config.maxDepth, minSamplesLeaf: config.minSamplesLeaf }, rng));
  }
  return { trees };
}

function predictForest(forest: OneVsRestForest, x: readonly number[]): number {
  const predictions = forest.trees.map((tree) => predictRegressionTree(tree, x));
  return predictions.reduce((s, v) => s + v, 0) / predictions.length;
}

interface RandomForestState {
  readonly forests: { readonly home: OneVsRestForest; readonly draw: OneVsRestForest; readonly away: OneVsRestForest };
  readonly imputer: Imputer;
}

export class RandomForestModel implements MlModel {
  private constructor(
    private readonly state: RandomForestState,
    readonly metadata: ModelMetadata,
  ) {}

  static train(params: TrainMlModelParams<RandomForestConfig>): RandomForestModel {
    const featureSchema = collectFeatureSchema(params.examples);
    const imputer = fitMedianImputer(params.examples, featureSchema);
    const X = params.examples.map((e) => {
      const imputed = applyImputer(toFeatureRow(e, featureSchema), imputer);
      return featureSchema.map((id) => imputed[id]!);
    });

    const rng = createSeededRng(params.randomSeed);
    const yFor = (target: Target1X2): number[] => params.examples.map((e) => (e.target1x2 === target ? 1 : 0));

    const forests = {
      home: trainForestForClass(X, yFor("HOME"), featureSchema.length, params.config, rng),
      draw: trainForestForClass(X, yFor("DRAW"), featureSchema.length, params.config, rng),
      away: trainForestForClass(X, yFor("AWAY"), featureSchema.length, params.config, rng),
    };

    const now: () => ISODateString = params.now ?? (() => new Date().toISOString());
    const metadata: ModelMetadata = {
      modelFamily: "random_forest",
      modelVersion: params.modelVersion,
      trainingDatasetVersion: params.trainingDatasetVersion,
      featureSchema,
      hyperparameters: { numTrees: params.config.numTrees, maxDepth: params.config.maxDepth, minSamplesLeaf: params.config.minSamplesLeaf, maxFeatures: params.config.maxFeatures ?? null },
      randomSeed: params.randomSeed,
      trainingTimestamp: now(),
      evaluationReference: undefined,
    };

    return new RandomForestModel({ forests, imputer }, metadata);
  }

  predictProba(row: FeatureRow): Probability1x2 {
    const imputed = applyImputer(row, this.state.imputer);
    const x = this.metadata.featureSchema.map((id) => imputed[id]!);
    return normalizeOneVsRest(predictForest(this.state.forests.home, x), predictForest(this.state.forests.draw, x), predictForest(this.state.forests.away, x));
  }

  predict(row: FeatureRow): Target1X2 {
    return argmax1x2(this.predictProba(row));
  }

  serialize(): SerializedModel {
    return { metadata: this.metadata, state: this.state };
  }

  static deserialize(serialized: SerializedModel): RandomForestModel {
    return new RandomForestModel(serialized.state as RandomForestState, serialized.metadata);
  }
}
