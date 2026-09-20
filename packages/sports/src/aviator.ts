import type { RoundOutcome } from "@tipstar/types";

/**
 * Aviator is a round-based event domain, not a team/fixture sport, so it
 * does not extend SportsProvider. It exposes round/multiplier history only.
 */
export interface MultiplierDistribution {
  readonly sampleSize: number;
  readonly buckets: readonly { readonly rangeMin: number; readonly rangeMax: number; readonly frequency: number }[];
  readonly computedAt: string;
}

export interface AviatorProvider {
  readonly providerId: string;

  getRoundHistory(params: { readonly limit: number; readonly before?: string }): Promise<readonly RoundOutcome[]>;
  getMultiplierDistribution(sampleSize: number): Promise<MultiplierDistribution>;
}
