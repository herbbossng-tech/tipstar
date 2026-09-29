/**
 * Shared probability types (Section 05 §16, §19 — Probability
 * Consistency Engine / Probability Output Contract). Every model family
 * (baselines, Poisson, Dixon-Coles, Monte Carlo, ML, ensemble,
 * calibration) produces or consumes these same shapes, so "1X2 sums to
 * 1" and "markets are derived consistently from one distribution" are
 * questions this codebase can only ever answer once, not once per model.
 */

export interface Probability1x2 {
  readonly home: number;
  readonly draw: number;
  readonly away: number;
}

/** A generic two-outcome market probability (BTTS yes/no, Over/Under N.5). */
export interface BinaryProbability {
  readonly yes: number;
  readonly no: number;
}

export interface ScorelineProbability {
  readonly homeGoals: number;
  readonly awayGoals: number;
  readonly probability: number;
}

/** A full scoreline probability distribution — every (homeGoals, awayGoals) pair this model assigned non-negligible mass to. Every derived market (1X2, BTTS, totals) should come FROM this, not be computed independently, whenever a model produces one at all (see scoreline.ts). */
export type ScorelineDistribution = readonly ScorelineProbability[];
