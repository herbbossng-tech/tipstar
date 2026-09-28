import type { BinaryProbability, Probability1x2, ScorelineDistribution } from "./types.js";

/**
 * Derives 1X2 / BTTS / Over-Under consistently from ONE shared
 * scoreline distribution — Section 05 §16: "If probabilities are
 * generated from a shared scoreline distribution, derive markets
 * consistently instead of generating contradictory independent
 * probabilities." Poisson, Dixon-Coles, and Monte Carlo (which all
 * naturally produce a scoreline distribution) build their market
 * outputs through these functions rather than each re-deriving their
 * own — the same reasoning as features/history.ts being the one shared
 * leakage-safe primitive instead of five slightly-different ones.
 */

export function derive1x2FromScoreline(distribution: ScorelineDistribution): Probability1x2 {
  let home = 0;
  let draw = 0;
  let away = 0;
  for (const { homeGoals, awayGoals, probability } of distribution) {
    if (homeGoals > awayGoals) home += probability;
    else if (homeGoals < awayGoals) away += probability;
    else draw += probability;
  }
  return { home, draw, away };
}

export function deriveBttsFromScoreline(distribution: ScorelineDistribution): BinaryProbability {
  let yes = 0;
  for (const { homeGoals, awayGoals, probability } of distribution) {
    if (homeGoals > 0 && awayGoals > 0) yes += probability;
  }
  return { yes, no: 1 - yes };
}

/** `threshold` is the line (e.g. 2.5 for "Over/Under 2.5 goals") — total goals strictly greater than the threshold count as Over. */
export function deriveOverUnderFromScoreline(distribution: ScorelineDistribution, threshold: number): BinaryProbability {
  let over = 0;
  for (const { homeGoals, awayGoals, probability } of distribution) {
    if (homeGoals + awayGoals > threshold) over += probability;
  }
  return { yes: over, no: 1 - over };
}

/** Total probability mass in the distribution — should be ~1 for a well-formed distribution; exposed so callers/tests can verify normalization rather than assuming it. */
export function totalMass(distribution: ScorelineDistribution): number {
  return distribution.reduce((sum, s) => sum + s.probability, 0);
}
