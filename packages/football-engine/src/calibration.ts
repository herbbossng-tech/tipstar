import { ValidationError, type ISODateString } from "@sport-os/shared";
import type { Target1X2 } from "./dataset/types.js";
import { createSeededRng } from "./monte-carlo.js";
import type { Probability1x2 } from "./probability/types.js";

/**
 * Calibration Engine — Section 05 §17 (supersedes the Section 01
 * `ProbabilityCalibrator` placeholder, which fixed a single-scalar
 * `calibrate(rawProbability): Promise<CalibratedProbability>` with no
 * fitting logic). Adjusts raw model probabilities so they match
 * observed outcome frequencies — real Platt (logistic) and isotonic
 * calibration, each fit one-vs-rest per class then renormalized, never
 * both applied automatically (selectCalibrator picks one via time-safe
 * validation log-loss).
 */

export const CalibratorType = { PLATT: "platt", ISOTONIC: "isotonic" } as const;
export type CalibratorType = (typeof CalibratorType)[keyof typeof CalibratorType];

export interface CalibratorMetadata {
  readonly calibratorType: CalibratorType;
  readonly calibratorVersion: string;
  readonly trainingRangeStart: ISODateString;
  readonly trainingRangeEnd: ISODateString;
  readonly inputModelVersion: string;
  readonly calibrationDatasetVersion: string;
}

export interface CalibrationExample {
  readonly rawProbability1x2: Probability1x2;
  readonly actual: Target1X2;
  readonly kickoffTime: ISODateString;
}

export interface Calibrator {
  readonly metadata: CalibratorMetadata;
  calibrate(raw: Probability1x2): Probability1x2;
}

function probabilityAtClass(p: Probability1x2, target: Target1X2): number {
  return target === "HOME" ? p.home : target === "DRAW" ? p.draw : p.away;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

// ============================================================
// Platt (logistic) calibration — fits calibrated = sigmoid(a*raw + b)
// per class via gradient descent on log-loss (2 real parameters).
// ============================================================

interface PlattParams {
  readonly a: number;
  readonly b: number;
}

export interface PlattConfig {
  readonly epochs: number;
  readonly learningRate: number;
  readonly seed: number;
}

function fitPlattForClass(points: readonly { raw: number; actual: number }[], config: PlattConfig): PlattParams {
  let a = 1;
  let b = 0;
  const rng = createSeededRng(config.seed);
  const indices = points.map((_, i) => i);

  for (let epoch = 0; epoch < config.epochs; epoch++) {
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [indices[i], indices[j]] = [indices[j]!, indices[i]!];
    }
    for (const idx of indices) {
      const { raw, actual } = points[idx]!;
      const predicted = sigmoid(a * raw + b);
      const gradA = (predicted - actual) * raw;
      const gradB = predicted - actual;
      a -= config.learningRate * gradA;
      b -= config.learningRate * gradB;
    }
  }
  return { a, b };
}

// ============================================================
// Isotonic calibration — Pool Adjacent Violators (PAVA), the standard
// algorithm for fitting a monotone non-decreasing step function. This
// is the reference (repeated-adjacent-merge) formulation rather than
// the faster O(n) stack-based one — mathematically identical result,
// simpler to verify correct at this dataset scale.
// ============================================================

interface IsotonicBlock {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMean: number;
}

function fitIsotonicForClass(points: readonly { raw: number; actual: number }[]): readonly IsotonicBlock[] {
  const sorted = [...points].sort((p, q) => p.raw - q.raw);
  let blocks: { xMin: number; xMax: number; yMean: number; weight: number }[] = sorted.map((p) => ({ xMin: p.raw, xMax: p.raw, yMean: p.actual, weight: 1 }));

  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < blocks.length - 1; i++) {
      if (blocks[i]!.yMean > blocks[i + 1]!.yMean) {
        const left = blocks[i]!;
        const right = blocks[i + 1]!;
        const weight = left.weight + right.weight;
        const yMean = (left.yMean * left.weight + right.yMean * right.weight) / weight;
        blocks = [...blocks.slice(0, i), { xMin: left.xMin, xMax: right.xMax, yMean, weight }, ...blocks.slice(i + 2)];
        merged = true;
        break;
      }
    }
  }

  return blocks.map(({ xMin, xMax, yMean }) => ({ xMin, xMax, yMean }));
}

function predictIsotonic(blocks: readonly IsotonicBlock[], x: number): number {
  if (blocks.length === 0) return x;
  if (x <= blocks[0]!.xMin) return blocks[0]!.yMean;
  if (x >= blocks[blocks.length - 1]!.xMax) return blocks[blocks.length - 1]!.yMean;
  for (const block of blocks) {
    if (x >= block.xMin && x <= block.xMax) return block.yMean;
  }
  // x falls in a gap between two blocks (no training point landed there) — linearly interpolate between the nearest two blocks' means, preserving monotonicity.
  for (let i = 0; i < blocks.length - 1; i++) {
    if (x > blocks[i]!.xMax && x < blocks[i + 1]!.xMin) {
      const span = blocks[i + 1]!.xMin - blocks[i]!.xMax;
      const t = span === 0 ? 0 : (x - blocks[i]!.xMax) / span;
      return blocks[i]!.yMean + t * (blocks[i + 1]!.yMean - blocks[i]!.yMean);
    }
  }
  return blocks[blocks.length - 1]!.yMean;
}

function renormalize(home: number, draw: number, away: number): Probability1x2 {
  const h = Math.min(Math.max(home, 0), 1);
  const d = Math.min(Math.max(draw, 0), 1);
  const a = Math.min(Math.max(away, 0), 1);
  const sum = h + d + a;
  if (sum <= 0) return { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
  return { home: h / sum, draw: d / sum, away: a / sum };
}

export interface FitCalibratorParams {
  readonly examples: readonly CalibrationExample[];
  readonly calibratorVersion: string;
  readonly inputModelVersion: string;
  readonly calibrationDatasetVersion: string;
  readonly plattConfig?: PlattConfig;
}

function trainingRange(examples: readonly CalibrationExample[]): { start: ISODateString; end: ISODateString } {
  const times = examples.map((e) => new Date(e.kickoffTime).getTime());
  return { start: new Date(Math.min(...times)).toISOString(), end: new Date(Math.max(...times)).toISOString() };
}

const CLASSES: readonly Target1X2[] = ["HOME", "DRAW", "AWAY"];

export function fitPlattCalibrator(params: FitCalibratorParams): Calibrator {
  const config = params.plattConfig ?? { epochs: 100, learningRate: 0.05, seed: 1 };
  const range = trainingRange(params.examples);
  const perClass = new Map<Target1X2, PlattParams>();
  for (const cls of CLASSES) {
    const points = params.examples.map((e) => ({ raw: probabilityAtClass(e.rawProbability1x2, cls), actual: e.actual === cls ? 1 : 0 }));
    perClass.set(cls, fitPlattForClass(points, config));
  }

  return {
    metadata: { calibratorType: CalibratorType.PLATT, calibratorVersion: params.calibratorVersion, trainingRangeStart: range.start, trainingRangeEnd: range.end, inputModelVersion: params.inputModelVersion, calibrationDatasetVersion: params.calibrationDatasetVersion },
    calibrate(raw: Probability1x2): Probability1x2 {
      const home = sigmoid(perClass.get("HOME")!.a * raw.home + perClass.get("HOME")!.b);
      const draw = sigmoid(perClass.get("DRAW")!.a * raw.draw + perClass.get("DRAW")!.b);
      const away = sigmoid(perClass.get("AWAY")!.a * raw.away + perClass.get("AWAY")!.b);
      return renormalize(home, draw, away);
    },
  };
}

export function fitIsotonicCalibrator(params: FitCalibratorParams): Calibrator {
  const range = trainingRange(params.examples);
  const perClass = new Map<Target1X2, readonly IsotonicBlock[]>();
  for (const cls of CLASSES) {
    const points = params.examples.map((e) => ({ raw: probabilityAtClass(e.rawProbability1x2, cls), actual: e.actual === cls ? 1 : 0 }));
    perClass.set(cls, fitIsotonicForClass(points));
  }

  return {
    metadata: { calibratorType: CalibratorType.ISOTONIC, calibratorVersion: params.calibratorVersion, trainingRangeStart: range.start, trainingRangeEnd: range.end, inputModelVersion: params.inputModelVersion, calibrationDatasetVersion: params.calibrationDatasetVersion },
    calibrate(raw: Probability1x2): Probability1x2 {
      const home = predictIsotonic(perClass.get("HOME")!, raw.home);
      const draw = predictIsotonic(perClass.get("DRAW")!, raw.draw);
      const away = predictIsotonic(perClass.get("AWAY")!, raw.away);
      return renormalize(home, draw, away);
    },
  };
}

function logLoss(calibrator: Calibrator, examples: readonly CalibrationExample[]): number {
  let total = 0;
  for (const e of examples) {
    const calibrated = calibrator.calibrate(e.rawProbability1x2);
    const p = Math.max(probabilityAtClass(calibrated, e.actual), 1e-12);
    total += -Math.log(p);
  }
  return total / examples.length;
}

/**
 * Selects whichever candidate calibrator has the lower log-loss on
 * `validationExamples` — "Calibration selection must be based on
 * time-safe validation." The candidates themselves must already have
 * been fit on a training split that excludes `validationExamples`
 * (fitPlattCalibrator/fitIsotonicCalibrator take whatever examples they
 * are given at face value; keeping training/validation/test separate is
 * the caller's responsibility, exactly like walk-forward.ts's own
 * split/window contract).
 */
export function selectCalibrator(candidates: readonly Calibrator[], validationExamples: readonly CalibrationExample[]): { readonly calibrator: Calibrator; readonly validationLogLoss: number } {
  let best: { calibrator: Calibrator; validationLogLoss: number } | undefined;
  for (const candidate of candidates) {
    const loss = logLoss(candidate, validationExamples);
    if (!best || loss < best.validationLogLoss) {
      best = { calibrator: candidate, validationLogLoss: loss };
    }
  }
  if (!best) throw new ValidationError({ message: "selectCalibrator requires at least one candidate.", code: "CALIBRATOR_NO_CANDIDATES" });
  return best;
}
