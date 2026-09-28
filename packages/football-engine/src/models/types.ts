import type { ISODateString } from "@sport-os/shared";
import type { Target1X2, TrainingExample } from "../dataset/types.js";
import type { Probability1x2 } from "../probability/types.js";

/**
 * ML model abstraction — Section 05 §11 (supersedes the Section 01
 * `MlModel` placeholder, which fixed only a
 * `predict(eventId, features): Promise<MlModelOutput>` shape with no
 * training, versioning, or implementation at all).
 *
 * `FeatureRow` is the flat numeric input a model actually consumes —
 * derived from a FeatureVector by extracting each feature's `.value`
 * (see toFeatureRow in encode.ts). Nulls are handled by each model's
 * fitted imputer (see encode.ts's Imputer), never passed to a model's
 * internal math directly.
 */
export type FeatureRow = Readonly<Record<string, number | null>>;

export interface ModelMetadata {
  readonly modelFamily: string;
  readonly modelVersion: string;
  readonly trainingDatasetVersion: string;
  /** featureIds the model was trained on, in a fixed order — a model must refuse (or is meaningless) to predict against a differently-shaped row. */
  readonly featureSchema: readonly string[];
  readonly hyperparameters: Readonly<Record<string, unknown>>;
  readonly randomSeed: number;
  readonly trainingTimestamp: ISODateString;
  /** Set once an EvaluationRun exists for this model — undefined for a freshly trained, not-yet-evaluated model. Never fabricated ahead of a real evaluation. */
  readonly evaluationReference: string | undefined;
}

/** A model's fully self-contained, JSON-serializable state — what a database/file persistence layer would actually store (see repositories/intelligence.ts's model_versions table). */
export interface SerializedModel {
  readonly metadata: ModelMetadata;
  readonly state: unknown;
}

export interface MlModel {
  readonly metadata: ModelMetadata;
  predictProba(row: FeatureRow): Probability1x2;
  predict(row: FeatureRow): Target1X2;
  serialize(): SerializedModel;
}

export interface TrainMlModelParams<TConfig> {
  readonly examples: readonly TrainingExample[];
  readonly config: TConfig;
  readonly randomSeed: number;
  readonly modelVersion: string;
  readonly trainingDatasetVersion: string;
  readonly now?: () => ISODateString;
}

function argmax1x2(p: Probability1x2): Target1X2 {
  if (p.home >= p.draw && p.home >= p.away) return "HOME";
  if (p.away >= p.draw && p.away >= p.home) return "AWAY";
  return "DRAW";
}

export { argmax1x2 };
