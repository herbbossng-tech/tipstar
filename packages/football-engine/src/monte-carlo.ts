import { InternalError } from "@sport-os/shared";
import { checkScorelineDistribution } from "./probability/consistency.js";
import { derive1x2FromScoreline, deriveBttsFromScoreline, deriveOverUnderFromScoreline } from "./probability/scoreline.js";
import type { BinaryProbability, Probability1x2, ScorelineDistribution } from "./probability/types.js";

/**
 * Monte Carlo simulation engine — Section 05 §14 (supersedes the
 * Section 01 `MonteCarloSimulator` placeholder). Deterministic: a
 * seeded PRNG (mulberry32 — small, fast, well-distributed, no external
 * dependency) means the same (distribution, seed, iterations) always
 * produces the exact same result.
 *
 * Takes an existing ScorelineDistribution (from statistical/poisson.ts
 * or statistical/dixon-coles.ts) as its input and samples `iterations`
 * scorelines from it via inverse-CDF sampling, then derives every
 * output market from the resulting EMPIRICAL distribution using the
 * same probability/scoreline.ts functions every other model uses — so
 * 1X2/BTTS/Over-Under here are consistent with each other by
 * construction, not independently re-derived. This also means the
 * simulation's own convergence (empirical distribution approaching the
 * analytic input distribution as iterations grows) is directly
 * testable — see monte-carlo.test.ts.
 */

export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return function mulberry32(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MonteCarloConfig {
  readonly iterations: number;
  readonly seed: number;
  /** Over/Under goal lines to compute — kept small and explicit rather than every conceivable threshold. */
  readonly overUnderThresholds?: readonly number[];
}

export interface MonteCarloResult {
  readonly iterations: number;
  readonly seed: number;
  readonly probability1x2: Probability1x2;
  readonly btts: BinaryProbability;
  /** Keyed by threshold, e.g. "2.5". */
  readonly overUnder: Readonly<Record<string, BinaryProbability>>;
  /** The empirical scoreline distribution the sample actually produced — not the analytic input distribution (compare the two to sanity-check convergence). */
  readonly correctScoreDistribution: ScorelineDistribution;
  /** Standard error of the home-win probability estimate (sqrt(p(1-p)/n)) — illustrative sampling uncertainty, not a claim about the underlying model's accuracy. Simulation output is a probability estimate, never a guarantee. */
  readonly homeWinStandardError: number;
}

const DEFAULT_OVER_UNDER_THRESHOLDS: readonly number[] = [0.5, 1.5, 2.5, 3.5];

function buildCumulative(distribution: ScorelineDistribution): { cumulative: readonly number[]; scorelines: ScorelineDistribution } {
  let running = 0;
  const cumulative: number[] = [];
  for (const s of distribution) {
    running += s.probability;
    cumulative.push(running);
  }
  return { cumulative, scorelines: distribution };
}

function sampleOne(cumulative: readonly number[], scorelines: ScorelineDistribution, u: number): { homeGoals: number; awayGoals: number } {
  for (let i = 0; i < cumulative.length; i++) {
    if (u <= cumulative[i]!) return { homeGoals: scorelines[i]!.homeGoals, awayGoals: scorelines[i]!.awayGoals };
  }
  // Floating-point edge case: u landed fractionally above the last cumulative value — fall back to the final cell rather than sampling nothing.
  const last = scorelines[scorelines.length - 1]!;
  return { homeGoals: last.homeGoals, awayGoals: last.awayGoals };
}

export function runMonteCarloSimulation(inputDistribution: ScorelineDistribution, config: MonteCarloConfig): MonteCarloResult {
  if (config.iterations <= 0 || !Number.isInteger(config.iterations)) {
    throw new InternalError({ message: "Monte Carlo iterations must be a positive integer.", code: "MONTE_CARLO_INVALID_ITERATIONS", context: { iterations: config.iterations } });
  }
  const inputCheck = checkScorelineDistribution(inputDistribution);
  if (!inputCheck.ok) {
    throw new InternalError({ message: "Monte Carlo received an invalid input distribution.", code: "MONTE_CARLO_INVALID_INPUT", context: { reason: inputCheck.error.message } });
  }

  const rng = createSeededRng(config.seed);
  const { cumulative, scorelines } = buildCumulative(inputDistribution);

  const tally = new Map<string, number>();
  for (let i = 0; i < config.iterations; i++) {
    const { homeGoals, awayGoals } = sampleOne(cumulative, scorelines, rng());
    const key = `${homeGoals}-${awayGoals}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }

  const empiricalDistribution: ScorelineDistribution = [...tally.entries()].map(([key, count]) => {
    const [h, a] = key.split("-").map(Number);
    return { homeGoals: h!, awayGoals: a!, probability: count / config.iterations };
  });

  const empiricalCheck = checkScorelineDistribution(empiricalDistribution);
  if (!empiricalCheck.ok) {
    // Should be unreachable — every sample came from a validated input
    // distribution and counts always sum to `iterations` — kept as
    // defense in depth, the same reasoning leakage-guard.ts applies to
    // its own re-checks.
    throw new InternalError({ message: "Monte Carlo produced an internally inconsistent empirical distribution.", code: "MONTE_CARLO_INTERNAL_INCONSISTENCY", context: { reason: empiricalCheck.error.message } });
  }

  const probability1x2 = derive1x2FromScoreline(empiricalDistribution);
  const btts = deriveBttsFromScoreline(empiricalDistribution);
  const overUnder: Record<string, BinaryProbability> = {};
  for (const threshold of config.overUnderThresholds ?? DEFAULT_OVER_UNDER_THRESHOLDS) {
    overUnder[String(threshold)] = deriveOverUnderFromScoreline(empiricalDistribution, threshold);
  }

  const p = probability1x2.home;
  const homeWinStandardError = Math.sqrt((p * (1 - p)) / config.iterations);

  return { iterations: config.iterations, seed: config.seed, probability1x2, btts, overUnder, correctScoreDistribution: empiricalDistribution, homeWinStandardError };
}
