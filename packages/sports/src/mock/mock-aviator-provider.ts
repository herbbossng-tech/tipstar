/**
 * DEVELOPMENT-ONLY MOCK ADAPTER. See mock-football-provider.ts header for
 * the rules governing mock adapters — never wire this into production.
 *
 * Does NOT imply any particular multiplier is predictable; it exists so the
 * Aviator Agent's statistical pipeline (regime detection, backtesting) can
 * be built and tested against a stable fixture.
 */
import type { RoundOutcome } from "@tipstar/types";
import { Sport } from "@tipstar/types";
import type { AviatorProvider, MultiplierDistribution } from "../aviator.js";

export class MockAviatorProvider implements AviatorProvider {
  readonly providerId = "mock";

  async getRoundHistory(params: { readonly limit: number }): Promise<RoundOutcome[]> {
    return Array.from({ length: params.limit }, (_, i) => ({
      roundId: `mock-round-${i}`,
      sport: Sport.AVIATOR,
      multiplier: Number((1 + Math.abs(Math.sin(i)) * 5).toFixed(2)),
      occurredAt: new Date(Date.now() - i * 60_000).toISOString(),
      provider: { providerId: this.providerId, providerEventId: `mock-round-${i}` },
    }));
  }

  async getMultiplierDistribution(sampleSize: number): Promise<MultiplierDistribution> {
    return {
      sampleSize,
      buckets: [
        { rangeMin: 1, rangeMax: 2, frequency: 0.45 },
        { rangeMin: 2, rangeMax: 5, frequency: 0.35 },
        { rangeMin: 5, rangeMax: 10, frequency: 0.15 },
        { rangeMin: 10, rangeMax: Number.POSITIVE_INFINITY, frequency: 0.05 },
      ],
      computedAt: new Date().toISOString(),
    };
  }
}
