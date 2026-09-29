import { ValidationError, err, ok, type Result } from "@sport-os/shared";
import type { Target1X2 } from "./dataset/types.js";
import { createSeededRng } from "./monte-carlo.js";
import { checkProbability1x2 } from "./probability/consistency.js";
import type { Probability1x2 } from "./probability/types.js";

/**
 * Ensemble Engine — Section 05 §15 (supersedes the Section 01
 * `EnsembleCombiner` placeholder, which fixed an untyped
 * `Record<string, number>` probabilities shape and no combination logic
 * at all). Combines named components (ML models, Elo/Poisson/Dixon-
 * Coles baselines, market-implied) into one Probability1x2.
 *
 * Never hard-codes an arbitrary weight scheme presented as optimal —
 * `EnsembleConfig.weights` must come from one of two places:
 *  1. a fixed, explicitly documented experiment config (weightSource:
 *     "configured_baseline") — a legitimate thing to try and measure,
 *     but never claimed to be tuned/optimal; or
 *  2. `learnEnsembleWeights()` below, fit only on a validation-period
 *     sample the caller supplies (weightSource: "learned") — test data
 *     must never reach this function.
 */

export interface EnsembleComponentPrediction {
  readonly name: string;
  readonly modelVersion: string;
  readonly probability1x2: Probability1x2;
}

export type EnsembleWeightSource = "configured_baseline" | "learned";

export interface EnsembleConfig {
  readonly ensembleVersion: string;
  readonly weightSource: EnsembleWeightSource;
  /** Keyed by component name. A component with no entry (or weight 0) contributes nothing and is excluded from renormalization — see combineEnsemble's "graceful degradation" comment. */
  readonly weights: Readonly<Record<string, number>>;
}

export interface EnsembleOutput {
  readonly ensembleVersion: string;
  readonly weightSource: EnsembleWeightSource;
  readonly probability1x2: Probability1x2;
  /** Which components actually contributed (present in the input AND had a positive configured weight) and their effective (renormalized) share — full provenance of how this number was produced. */
  readonly componentContributions: Readonly<Record<string, { readonly modelVersion: string; readonly effectiveWeight: number }>>;
}

/**
 * Weighted average of every present component's Probability1x2. A
 * component the caller didn't supply for this fixture (e.g. no
 * trustworthy odds, so no market_implied prediction) simply isn't in
 * `components` — its configured weight is dropped and the remaining
 * weights are renormalized to still sum to 1, rather than silently
 * treating a missing component as contributing 0 probability mass
 * (which would corrupt the sum-to-1 invariant).
 */
export function combineEnsemble(components: readonly EnsembleComponentPrediction[], config: EnsembleConfig): Result<EnsembleOutput, ValidationError> {
  const contributing = components.filter((c) => (config.weights[c.name] ?? 0) > 0);
  if (contributing.length === 0) {
    return err(new ValidationError({ message: "No ensemble component with a positive configured weight was supplied.", code: "ENSEMBLE_NO_CONTRIBUTING_COMPONENTS" }));
  }

  const totalWeight = contributing.reduce((sum, c) => sum + config.weights[c.name]!, 0);

  let home = 0;
  let draw = 0;
  let away = 0;
  const componentContributions: Record<string, { modelVersion: string; effectiveWeight: number }> = {};
  for (const c of contributing) {
    const effectiveWeight = config.weights[c.name]! / totalWeight;
    home += effectiveWeight * c.probability1x2.home;
    draw += effectiveWeight * c.probability1x2.draw;
    away += effectiveWeight * c.probability1x2.away;
    componentContributions[c.name] = { modelVersion: c.modelVersion, effectiveWeight };
  }

  const combined = { home, draw, away };
  const check = checkProbability1x2(combined);
  if (!check.ok) {
    // Should be unreachable if every component's own probability was
    // itself valid (a weighted average of valid distributions with
    // weights summing to 1 is always valid) — defense in depth.
    return err(check.error);
  }

  return ok({ ensembleVersion: config.ensembleVersion, weightSource: config.weightSource, probability1x2: combined, componentContributions });
}

// ============================================================
// Learned weights — fit only on a validation-period sample.
// ============================================================

function probabilityAtClass(p: Probability1x2, target: Target1X2): number {
  return target === "HOME" ? p.home : target === "DRAW" ? p.draw : p.away;
}

function softmax(theta: readonly number[]): number[] {
  const max = Math.max(...theta);
  const exps = theta.map((t) => Math.exp(t - max));
  const sum = exps.reduce((s, v) => s + v, 0);
  return exps.map((v) => v / sum);
}

export interface EnsembleValidationExample {
  /** Keyed by component name — a component missing for this example contributes 0 to the blend on this example only (its weight still updates correctly via the gradient below). */
  readonly components: Readonly<Record<string, Probability1x2>>;
  readonly actual: Target1X2;
}

export interface LearnEnsembleWeightsConfig {
  readonly epochs: number;
  readonly learningRate: number;
  readonly seed: number;
}

/**
 * Fits ensemble weights by minimizing multiclass log-loss over
 * `validationExamples` via gradient descent on a softmax
 * reparameterization (weights = softmax(theta), guaranteeing
 * non-negative weights summing to 1 by construction — no separate
 * projection/clipping step needed). The gradient
 * `dL/dtheta_j = w_j * (1 - P_j(actual) / p_actual)` is the exact
 * derivative of per-example cross-entropy through both the blend and
 * the softmax reweighting — see the module's design notes in
 * docs/architecture/MODEL_VALIDATION.md for the derivation.
 *
 * The caller is responsible for ensuring `validationExamples` comes
 * only from a validation-period walk-forward split — this function has
 * no notion of time itself and cannot enforce that on its own.
 */
export function learnEnsembleWeights(componentNames: readonly string[], validationExamples: readonly EnsembleValidationExample[], config: LearnEnsembleWeightsConfig): Readonly<Record<string, number>> {
  if (componentNames.length === 0 || validationExamples.length === 0) {
    return Object.fromEntries(componentNames.map((name) => [name, componentNames.length > 0 ? 1 / componentNames.length : 0]));
  }

  let theta = componentNames.map(() => 0);
  const rng = createSeededRng(config.seed);
  const indices = validationExamples.map((_, i) => i);

  for (let epoch = 0; epoch < config.epochs; epoch++) {
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [indices[i], indices[j]] = [indices[j]!, indices[i]!];
    }

    for (const idx of indices) {
      const example = validationExamples[idx]!;
      const weights = softmax(theta);

      const perComponentActual = componentNames.map((name) => {
        const prediction = example.components[name];
        return prediction ? probabilityAtClass(prediction, example.actual) : 0;
      });
      const pActual = Math.max(weights.reduce((sum, w, k) => sum + w * perComponentActual[k]!, 0), 1e-9);

      const gradient = weights.map((w, k) => w * (1 - perComponentActual[k]! / pActual));
      theta = theta.map((t, k) => t - config.learningRate * gradient[k]!);
    }
  }

  const finalWeights = softmax(theta);
  return Object.fromEntries(componentNames.map((name, k) => [name, finalWeights[k]!]));
}
