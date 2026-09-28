/**
 * ML Models boundary (Section 01 — Aviator Engine Boundary). Future
 * training must use time-aware validation and fit only on its training
 * window — see docs/data/DATA_LEAKAGE_PRINCIPLE.md. No model is trained
 * or implemented yet.
 */
export interface AviatorMlOutput {
  readonly predictedMultiplierRange: readonly [number, number] | null;
  readonly modelVersion: string;
}

export interface AviatorMlModel {
  predict(features: Readonly<Record<string, number | null>>): Promise<AviatorMlOutput>;
}
