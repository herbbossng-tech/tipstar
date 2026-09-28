import type { Probability1x2 } from "../probability/types.js";

/**
 * Shared one-vs-rest → Probability1x2 normalization for both Random
 * Forest and Gradient Boosted Trees (models/random-forest.ts,
 * models/gradient-boosted-trees.ts): each trains 3 independent binary
 * regressors (HOME-vs-rest, DRAW-vs-rest, AWAY-vs-rest) and this turns
 * their 3 raw scores into a valid Probability1x2 — clamped
 * non-negative, then proportionally normalized to sum to exactly 1. If
 * all three raw scores are non-positive (a degenerate case that should
 * be rare with a reasonably trained model), falls back to equal
 * probability rather than dividing by zero.
 */
export function normalizeOneVsRest(homeRaw: number, drawRaw: number, awayRaw: number): Probability1x2 {
  const home = Math.max(homeRaw, 0);
  const draw = Math.max(drawRaw, 0);
  const away = Math.max(awayRaw, 0);
  const sum = home + draw + away;
  if (sum <= 0) return { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
  return { home: home / sum, draw: draw / sum, away: away / sum };
}
