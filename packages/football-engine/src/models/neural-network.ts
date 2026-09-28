import type { ISODateString } from "@sport-os/shared";
import { createSeededRng } from "../monte-carlo.js";
import type { Probability1x2 } from "../probability/types.js";
import { applyImputer, collectFeatureSchema, fitMedianImputer, toFeatureRow, type Imputer } from "./encode.js";
import { argmax1x2, type FeatureRow, type MlModel, type ModelMetadata, type SerializedModel, type TrainMlModelParams } from "./types.js";
import type { Target1X2 } from "../dataset/types.js";

/**
 * Neural Network — Section 05 §11. A real, from-scratch single-hidden-
 * layer MLP (tanh hidden activation, softmax output over
 * HOME/DRAW/AWAY) trained by full backpropagation with per-example
 * stochastic gradient descent and a small L2 weight-decay term — not a
 * TensorFlow.js/ONNX binding (no such dependency exists in this
 * codebase — see docs/architecture/MODEL_VALIDATION.md's "ML runtime
 * boundary" for why a small hand-rolled network was preferred over
 * adding a large ML runtime dependency for one model family). Small
 * does not mean fake: every weight update below is the exact gradient
 * of categorical cross-entropy through a real forward pass.
 *
 * Input features are standardized (zero mean, unit variance) using
 * statistics fit ONLY from the training split — the same "scaler
 * leakage" discipline as encode.ts's median imputer.
 */

export interface NeuralNetworkConfig {
  readonly hiddenUnits: number;
  readonly learningRate: number;
  readonly epochs: number;
  readonly l2: number;
}

function tanh(x: number): number {
  return Math.tanh(x);
}

function softmax(logits: readonly number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const sum = exps.reduce((s, v) => s + v, 0);
  return exps.map((v) => v / sum);
}

function standardize(x: readonly number[], means: readonly number[], stds: readonly number[]): number[] {
  return x.map((v, i) => (stds[i]! > 1e-9 ? (v - means[i]!) / stds[i]! : 0));
}

interface NeuralNetworkState {
  readonly W1: number[][];
  readonly b1: number[];
  readonly W2: number[][];
  readonly b2: number[];
  readonly imputer: Imputer;
  readonly featureMeans: number[];
  readonly featureStds: number[];
}

const CLASS_ORDER: readonly Target1X2[] = ["HOME", "DRAW", "AWAY"];

function forward(state: NeuralNetworkState, x: readonly number[]): { hidden: number[]; probs: number[] } {
  const hidden = state.W1.map((row, i) => tanh(row.reduce((s, w, j) => s + w * x[j]!, 0) + state.b1[i]!));
  const logits = state.W2.map((row, i) => row.reduce((s, w, j) => s + w * hidden[j]!, 0) + state.b2[i]!);
  return { hidden, probs: softmax(logits) };
}

export class NeuralNetworkModel implements MlModel {
  private constructor(
    private readonly state: NeuralNetworkState,
    readonly metadata: ModelMetadata,
  ) {}

  static train(params: TrainMlModelParams<NeuralNetworkConfig>): NeuralNetworkModel {
    const featureSchema = collectFeatureSchema(params.examples);
    const imputer = fitMedianImputer(params.examples, featureSchema);
    const rawX = params.examples.map((e) => {
      const imputed = applyImputer(toFeatureRow(e, featureSchema), imputer);
      return featureSchema.map((id) => imputed[id]!);
    });

    const featureCount = featureSchema.length;
    const featureMeans = featureSchema.map((_, j) => rawX.reduce((s, row) => s + row[j]!, 0) / rawX.length);
    const featureStds = featureSchema.map((_, j) => {
      const variance = rawX.reduce((s, row) => s + (row[j]! - featureMeans[j]!) ** 2, 0) / rawX.length;
      return Math.sqrt(variance);
    });
    const X = rawX.map((row) => standardize(row, featureMeans, featureStds));
    const Y = params.examples.map((e) => CLASS_ORDER.map((c) => (e.target1x2 === c ? 1 : 0)));

    const rng = createSeededRng(params.randomSeed);
    const scale = 1 / Math.sqrt(Math.max(featureCount, 1));
    const randomWeight = () => (rng() * 2 - 1) * scale;

    let state: NeuralNetworkState = {
      W1: Array.from({ length: params.config.hiddenUnits }, () => Array.from({ length: featureCount }, randomWeight)),
      b1: Array.from({ length: params.config.hiddenUnits }, () => 0),
      W2: Array.from({ length: 3 }, () => Array.from({ length: params.config.hiddenUnits }, randomWeight)),
      b2: [0, 0, 0],
      imputer,
      featureMeans,
      featureStds,
    };

    const indices = Array.from({ length: X.length }, (_, i) => i);

    for (let epoch = 0; epoch < params.config.epochs; epoch++) {
      // Shuffle with the same seeded RNG each epoch — deterministic given the seed, but still real stochastic gradient descent ordering.
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [indices[i], indices[j]] = [indices[j]!, indices[i]!];
      }

      for (const idx of indices) {
        const x = X[idx]!;
        const y = Y[idx]!;
        const { hidden, probs } = forward(state, x);

        const dLogits = probs.map((p, i) => p - y[i]!);

        const newW2 = state.W2.map((row, i) => row.map((w, j) => w - params.config.learningRate * (dLogits[i]! * hidden[j]! + params.config.l2 * w)));
        const newB2 = state.b2.map((b, i) => b - params.config.learningRate * dLogits[i]!);

        const dHidden = hidden.map((_, j) => state.W2.reduce((s, row, i) => s + row[j]! * dLogits[i]!, 0));
        const dZ1 = dHidden.map((dh, j) => dh * (1 - hidden[j]! * hidden[j]!));

        const newW1 = state.W1.map((row, i) => row.map((w, j) => w - params.config.learningRate * (dZ1[i]! * x[j]! + params.config.l2 * w)));
        const newB1 = state.b1.map((b, i) => b - params.config.learningRate * dZ1[i]!);

        state = { ...state, W1: newW1, b1: newB1, W2: newW2, b2: newB2 };
      }
    }

    const now: () => ISODateString = params.now ?? (() => new Date().toISOString());
    const metadata: ModelMetadata = {
      modelFamily: "neural_network",
      modelVersion: params.modelVersion,
      trainingDatasetVersion: params.trainingDatasetVersion,
      featureSchema,
      hyperparameters: { hiddenUnits: params.config.hiddenUnits, learningRate: params.config.learningRate, epochs: params.config.epochs, l2: params.config.l2 },
      randomSeed: params.randomSeed,
      trainingTimestamp: now(),
      evaluationReference: undefined,
    };

    return new NeuralNetworkModel(state, metadata);
  }

  predictProba(row: FeatureRow): Probability1x2 {
    const imputed = applyImputer(row, this.state.imputer);
    const raw = this.metadata.featureSchema.map((id) => imputed[id]!);
    const x = standardize(raw, this.state.featureMeans, this.state.featureStds);
    const { probs } = forward(this.state, x);
    return { home: probs[0]!, draw: probs[1]!, away: probs[2]! };
  }

  predict(row: FeatureRow): Target1X2 {
    return argmax1x2(this.predictProba(row));
  }

  serialize(): SerializedModel {
    return { metadata: this.metadata, state: this.state };
  }

  static deserialize(serialized: SerializedModel): NeuralNetworkModel {
    return new NeuralNetworkModel(serialized.state as NeuralNetworkState, serialized.metadata);
  }
}
