/**
 * Ensemble boundary (Section 01 — Football Engine Boundary). Combines
 * multiple model outputs (Elo, form, xG, statistical, ML, Monte Carlo)
 * into one probability estimate. No combination logic is implemented yet.
 */
export interface EnsembleInput {
  readonly source: string;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly weight: number;
}

export interface EnsembleOutput {
  readonly eventId: string;
  readonly probabilities: Readonly<Record<string, number>>;
}

export interface EnsembleCombiner {
  combine(eventId: string, inputs: readonly EnsembleInput[]): Promise<EnsembleOutput>;
}
