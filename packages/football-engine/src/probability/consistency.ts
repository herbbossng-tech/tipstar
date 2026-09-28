import { ValidationError, err, ok, type Result } from "@sport-os/shared";
import type { BinaryProbability, Probability1x2, ScorelineDistribution } from "./types.js";

/**
 * Probability Consistency Engine — Section 05 §16. Strict validation,
 * fail-closed: an invalid output is never silently clamped/renormalized
 * and passed through — see PROBABILITY_TOLERANCE's own comment for the
 * one narrow exception (floating-point rounding).
 */

/** Floating-point sums rarely land on exactly 1.0 — this tolerates only genuine floating-point rounding (~1e-9 scale drift), never a materially wrong distribution. */
const SUM_TOLERANCE = 1e-6;

function isValidProbabilityScalar(p: number): boolean {
  return Number.isFinite(p) && p >= 0 && p <= 1;
}

export function checkProbability1x2(p: Probability1x2): Result<Probability1x2, ValidationError> {
  for (const [label, value] of [
    ["home", p.home],
    ["draw", p.draw],
    ["away", p.away],
  ] as const) {
    if (!isValidProbabilityScalar(value)) {
      return err(new ValidationError({ message: `1X2 probability '${label}' is not a valid probability (must be finite, >= 0, <= 1).`, code: "PROBABILITY_OUT_OF_BOUNDS", context: { label, value } }));
    }
  }
  const sum = p.home + p.draw + p.away;
  if (Math.abs(sum - 1) > SUM_TOLERANCE) {
    return err(new ValidationError({ message: `1X2 probabilities must sum to 1 (got ${sum}).`, code: "PROBABILITY_SUM_INVALID", context: { sum, p } }));
  }
  return ok(p);
}

export function checkBinaryProbability(p: BinaryProbability, marketLabel: string): Result<BinaryProbability, ValidationError> {
  for (const [label, value] of [
    ["yes", p.yes],
    ["no", p.no],
  ] as const) {
    if (!isValidProbabilityScalar(value)) {
      return err(new ValidationError({ message: `${marketLabel} probability '${label}' is not a valid probability.`, code: "PROBABILITY_OUT_OF_BOUNDS", context: { marketLabel, label, value } }));
    }
  }
  const sum = p.yes + p.no;
  if (Math.abs(sum - 1) > SUM_TOLERANCE) {
    return err(new ValidationError({ message: `${marketLabel} yes/no probabilities must sum to 1 (got ${sum}).`, code: "PROBABILITY_SUM_INVALID", context: { marketLabel, sum, p } }));
  }
  return ok(p);
}

export function checkScorelineDistribution(distribution: ScorelineDistribution): Result<ScorelineDistribution, ValidationError> {
  if (distribution.length === 0) {
    return err(new ValidationError({ message: "Scoreline distribution must not be empty.", code: "SCORELINE_DISTRIBUTION_EMPTY" }));
  }
  let sum = 0;
  for (const s of distribution) {
    if (!isValidProbabilityScalar(s.probability)) {
      return err(new ValidationError({ message: `Scoreline (${s.homeGoals}-${s.awayGoals}) has an invalid probability.`, code: "PROBABILITY_OUT_OF_BOUNDS", context: { scoreline: s } }));
    }
    if (!Number.isInteger(s.homeGoals) || s.homeGoals < 0 || !Number.isInteger(s.awayGoals) || s.awayGoals < 0) {
      return err(new ValidationError({ message: `Scoreline (${s.homeGoals}-${s.awayGoals}) has a non-negative-integer violation.`, code: "SCORELINE_INVALID", context: { scoreline: s } }));
    }
    sum += s.probability;
  }
  if (Math.abs(sum - 1) > SUM_TOLERANCE) {
    return err(new ValidationError({ message: `Scoreline distribution must sum to 1 (got ${sum}).`, code: "PROBABILITY_SUM_INVALID", context: { sum } }));
  }
  return ok(distribution);
}

/**
 * Cumulative Over/Under coherence check: P(Over 0.5) must be >= P(Over
 * 1.5) >= P(Over 2.5) — a higher threshold can never be more likely
 * than a lower one when both are derived from the same distribution.
 * Only meaningful when both markets were derived from the SAME
 * scoreline distribution — see scoreline.ts.
 */
export function checkOverUnderCoherence(lowerThresholdOverProb: number, higherThresholdOverProb: number, lowerThreshold: number, higherThreshold: number): Result<true, ValidationError> {
  if (higherThreshold <= lowerThreshold) {
    return err(new ValidationError({ message: "higherThreshold must be greater than lowerThreshold.", code: "OVER_UNDER_THRESHOLD_ORDER_INVALID", context: { lowerThreshold, higherThreshold } }));
  }
  if (higherThresholdOverProb > lowerThresholdOverProb + SUM_TOLERANCE) {
    return err(
      new ValidationError({
        message: `Over ${higherThreshold} probability (${higherThresholdOverProb}) cannot exceed Over ${lowerThreshold} probability (${lowerThresholdOverProb}).`,
        code: "OVER_UNDER_NOT_MONOTONIC",
        context: { lowerThreshold, higherThreshold, lowerThresholdOverProb, higherThresholdOverProb },
      }),
    );
  }
  return ok(true);
}
