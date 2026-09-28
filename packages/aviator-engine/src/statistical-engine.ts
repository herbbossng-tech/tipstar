/**
 * Statistical Engine boundary (Section 01 — Aviator Engine Boundary). No
 * statistical modeling is implemented yet.
 */
export interface AviatorStatisticalOutput {
  readonly predictedMultiplierRange: readonly [number, number] | null;
  readonly modelVersion: string;
}

export interface AviatorStatisticalEngine {
  predict(features: Readonly<Record<string, number | null>>): Promise<AviatorStatisticalOutput>;
}
