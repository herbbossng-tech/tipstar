/**
 * Statistical (e.g. Poisson-family) model boundary (Section 01 — Football
 * Engine Boundary). No statistical modeling is implemented yet.
 */
export interface StatisticalModelOutput {
  readonly eventId: string;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly modelVersion: string;
}

export interface StatisticalModel {
  predict(eventId: string, features: Readonly<Record<string, number | null>>): Promise<StatisticalModelOutput>;
}
