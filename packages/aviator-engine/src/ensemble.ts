/**
 * Ensemble boundary (Section 01 — Aviator Engine Boundary). Combines
 * statistical and ML outputs into one signal. No combination logic is
 * implemented yet.
 */
export interface AviatorEnsembleInput {
  readonly source: string;
  readonly predictedMultiplierRange: readonly [number, number] | null;
  readonly weight: number;
}

export interface AviatorEnsembleOutput {
  readonly predictedMultiplierRange: readonly [number, number] | null;
}

export interface AviatorEnsembleCombiner {
  combine(inputs: readonly AviatorEnsembleInput[]): Promise<AviatorEnsembleOutput>;
}
