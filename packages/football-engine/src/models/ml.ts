/**
 * Machine-learning model boundary (Section 01 — Football Engine
 * Boundary). Future training MUST use time-aware validation and fit any
 * scaler/encoder/model only on its training window — see
 * docs/data/DATA_LEAKAGE_PRINCIPLE.md. No model is trained or implemented
 * yet.
 */
export interface MlModelOutput {
  readonly eventId: string;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly modelVersion: string;
}

export interface MlModel {
  predict(eventId: string, features: Readonly<Record<string, number | null>>): Promise<MlModelOutput>;
}
