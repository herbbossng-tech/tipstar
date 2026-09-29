import type { TrainingExample } from "../dataset/types.js";
import type { FeatureRow } from "./types.js";

/**
 * Feature encoding — Section 05 §6 ("Any imputation must be
 * deterministic, documented, fitted only on training data... unavailable
 * to future/test information") and §8 (imputer leakage). A median
 * imputer is fit ONCE, only from the training split's non-null values
 * for each feature, and its fitted medians are stored as part of the
 * model's serialized state (see models/types.ts's SerializedModel) —
 * the exact same medians are then applied at validation/test/inference
 * time, never refit on them.
 */

export type Imputer = Readonly<Record<string, number>>;

/** The union of every featureId present across a set of training examples, sorted alphabetically for a deterministic, reproducible column order — never dependent on object key insertion order. */
export function collectFeatureSchema(examples: readonly TrainingExample[]): readonly string[] {
  const ids = new Set<string>();
  for (const example of examples) {
    for (const featureId of Object.keys(example.features)) ids.add(featureId);
  }
  return [...ids].sort();
}

export function toFeatureRow(example: TrainingExample, featureSchema: readonly string[]): FeatureRow {
  const row: Record<string, number | null> = {};
  for (const featureId of featureSchema) {
    row[featureId] = example.features[featureId]?.value ?? null;
  }
  return row;
}

/** Fits a median imputer from training examples only — never call this on validation/test data. */
export function fitMedianImputer(trainingExamples: readonly TrainingExample[], featureSchema: readonly string[]): Imputer {
  const imputer: Record<string, number> = {};
  for (const featureId of featureSchema) {
    const values = trainingExamples.map((e) => e.features[featureId]?.value).filter((v): v is number => v !== null && v !== undefined);
    if (values.length === 0) {
      imputer[featureId] = 0; // documented edge case: a feature with zero non-null training observations imputes to 0, not a fabricated "typical" value.
      continue;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    imputer[featureId] = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  }
  return imputer;
}

/** Applies an already-fitted imputer to one row — never fits anything itself. */
export function applyImputer(row: FeatureRow, imputer: Imputer): Readonly<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const [featureId, value] of Object.entries(row)) {
    result[featureId] = value ?? imputer[featureId] ?? 0;
  }
  return result;
}
