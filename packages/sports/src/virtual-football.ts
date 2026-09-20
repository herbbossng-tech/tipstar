import type { UUID } from "@tipstar/types";
import type { SportsProvider } from "./provider.js";

/**
 * Virtual Football is modeled as its own domain, distinct from real
 * football (see architecture docs). It has no injuries/lineups/weather —
 * only recurring statistical/sequence patterns over its own event history.
 */
export interface ResultDistribution {
  readonly leagueId: UUID;
  readonly sampleSize: number;
  readonly outcomeFrequencies: Readonly<Record<string, number>>;
  readonly computedAt: string;
}

export interface VirtualFootballProvider extends SportsProvider {
  getResultDistribution(leagueId: UUID): Promise<ResultDistribution | null>;
  /** Ordered sequence of recent outcomes, used for sequence/streak analysis. */
  getRecentSequence(leagueId: UUID, count: number): Promise<readonly string[]>;
}
