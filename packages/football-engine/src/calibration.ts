/**
 * Calibration boundary (Section 01 — Football Engine Boundary). Adjusts
 * raw model probabilities so they match observed outcome frequencies over
 * time. Calibration fitting must only ever use a training window that
 * precedes what it's applied to — see docs/data/DATA_LEAKAGE_PRINCIPLE.md.
 * No calibration is implemented yet.
 */
export interface CalibratedProbability {
  readonly rawProbability: number;
  readonly calibratedProbability: number;
  readonly calibratorVersion: string;
}

export interface ProbabilityCalibrator {
  calibrate(rawProbability: number): Promise<CalibratedProbability>;
}
