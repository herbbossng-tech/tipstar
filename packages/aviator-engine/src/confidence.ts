/**
 * Confidence boundary (Section 01 — Aviator Engine Boundary). Scores how
 * reliable an ensemble output is before it becomes a signal. No scoring
 * logic is implemented yet.
 */
export interface ConfidenceScore {
  readonly value: number;
  readonly basis: readonly string[];
}

export interface ConfidenceScorer {
  score(ensembleOutput: unknown): Promise<ConfidenceScore>;
}
