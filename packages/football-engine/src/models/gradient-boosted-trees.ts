import type { ISODateString } from "@sport-os/shared";
import type { Target1X2 } from "../dataset/types.js";
import { createSeededRng } from "../monte-carlo.js";
import type { Probability1x2 } from "../probability/types.js";
import { predictRegressionTree, trainRegressionTree, type RegressionTreeNode } from "./decision-tree.js";
import { applyImputer, collectFeatureSchema, fitMedianImputer, toFeatureRow, type Imputer } from "./encode.js";
import { normalizeOneVsRest } from "./one-vs-rest.js";
import { argmax1x2, type FeatureRow, type MlModel, type ModelMetadata, type SerializedModel, type TrainMlModelParams } from "./types.js";

/**
 * Gradient Boosted Trees — Section 05 §11/§28. Real logistic gradient
 * boosting (the same family XGBoost/LightGBM/GBM belong to: each new
 * tree is fit to the negative gradient of log-loss, i.e. the current
 * residual `actual - sigmoid(rawScore)`, and added to a running raw
 * score with a learning-rate shrinkage) — not a binding to the
 * `xgboost` package (not a dependency of this codebase; see
 * docs/architecture/MODEL_VALIDATION.md's "ML runtime boundary" for
 * why). One boosted ensemble per outcome class (one-vs-rest), same
 * decision-tree base learner as random-forest.ts, same normalization
 * (one-vs-rest.ts) — the difference from Random Forest is purely
 * *how* the trees are combined (sequential error-correction vs.
 * parallel bagging), which is the actual mathematical distinction
 * between the two model families the spec asks for, not just two names
 * for the same thing.
 *
 * Also serves as this section's "Gradient Boosting" family (§11 lists
 * XGBoost and Gradient Boosting separately) — the same engine with
 * different hyperparameters (fewer/shallower trees, a different
 * learning rate) is a legitimate way to instantiate either, documented
 * here rather than duplicated as a second, near-identical file.
 */

export interface GradientBoostedTreesConfig {
  readonly numTrees: number;
  readonly maxDepth: number;
  readonly minSamplesLeaf: number;
  readonly learningRate: number;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

interface BoostedEnsemble {
  readonly baseScore: number;
  readonly trees: readonly RegressionTreeNode[];
  readonly learningRate: number;
}

function trainBoostedEnsembleForClass(X: readonly (readonly number[])[], y: readonly number[], featureCount: number, config: GradientBoostedTreesConfig, rng: () => number): BoostedEnsemble {
  const positiveRate = y.reduce((s, v) => s + v, 0) / y.length;
  const clampedRate = Math.min(Math.max(positiveRate, 1e-6), 1 - 1e-6);
  const baseScore = Math.log(clampedRate / (1 - clampedRate)); // log-odds of the base rate — the standard GBM initialization.

  const rawScores = new Array(X.length).fill(baseScore);
  const trees: RegressionTreeNode[] = [];

  for (let t = 0; t < config.numTrees; t++) {
    const residuals = rawScores.map((score, i) => y[i]! - sigmoid(score));
    const tree = trainRegressionTree(X, residuals, featureCount, { maxDepth: config.maxDepth, minSamplesLeaf: config.minSamplesLeaf }, rng);
    trees.push(tree);
    for (let i = 0; i < X.length; i++) {
      rawScores[i] += config.learningRate * predictRegressionTree(tree, X[i]!);
    }
  }

  return { baseScore, trees, learningRate: config.learningRate };
}

function predictBoostedEnsemble(ensemble: BoostedEnsemble, x: readonly number[]): number {
  let score = ensemble.baseScore;
  for (const tree of ensemble.trees) {
    score += ensemble.learningRate * predictRegressionTree(tree, x);
  }
  return sigmoid(score);
}

interface GradientBoostedTreesState {
  readonly ensembles: { readonly home: BoostedEnsemble; readonly draw: BoostedEnsemble; readonly away: BoostedEnsemble };
  readonly imputer: Imputer;
}

export class GradientBoostedTreesModel implements MlModel {
  private constructor(
    private readonly state: GradientBoostedTreesState,
    readonly metadata: ModelMetadata,
  ) {}

  static train(params: TrainMlModelParams<GradientBoostedTreesConfig>, modelFamily: string = "gradient_boosted_trees"): GradientBoostedTreesModel {
    const featureSchema = collectFeatureSchema(params.examples);
    const imputer = fitMedianImputer(params.examples, featureSchema);
    const X = params.examples.map((e) => {
      const imputed = applyImputer(toFeatureRow(e, featureSchema), imputer);
      return featureSchema.map((id) => imputed[id]!);
    });

    const rng = createSeededRng(params.randomSeed);
    const yFor = (target: Target1X2): number[] => params.examples.map((e) => (e.target1x2 === target ? 1 : 0));

    const ensembles = {
      home: trainBoostedEnsembleForClass(X, yFor("HOME"), featureSchema.length, params.config, rng),
      draw: trainBoostedEnsembleForClass(X, yFor("DRAW"), featureSchema.length, params.config, rng),
      away: trainBoostedEnsembleForClass(X, yFor("AWAY"), featureSchema.length, params.config, rng),
    };

    const now: () => ISODateString = params.now ?? (() => new Date().toISOString());
    const metadata: ModelMetadata = {
      modelFamily,
      modelVersion: params.modelVersion,
      trainingDatasetVersion: params.trainingDatasetVersion,
      featureSchema,
      hyperparameters: { numTrees: params.config.numTrees, maxDepth: params.config.maxDepth, minSamplesLeaf: params.config.minSamplesLeaf, learningRate: params.config.learningRate },
      randomSeed: params.randomSeed,
      trainingTimestamp: now(),
      evaluationReference: undefined,
    };

    return new GradientBoostedTreesModel({ ensembles, imputer }, metadata);
  }

  predictProba(row: FeatureRow): Probability1x2 {
    const imputed = applyImputer(row, this.state.imputer);
    const x = this.metadata.featureSchema.map((id) => imputed[id]!);
    return normalizeOneVsRest(predictBoostedEnsemble(this.state.ensembles.home, x), predictBoostedEnsemble(this.state.ensembles.draw, x), predictBoostedEnsemble(this.state.ensembles.away, x));
  }

  predict(row: FeatureRow): Target1X2 {
    return argmax1x2(this.predictProba(row));
  }

  serialize(): SerializedModel {
    return { metadata: this.metadata, state: this.state };
  }

  static deserialize(serialized: SerializedModel): GradientBoostedTreesModel {
    return new GradientBoostedTreesModel(serialized.state as GradientBoostedTreesState, serialized.metadata);
  }
}
