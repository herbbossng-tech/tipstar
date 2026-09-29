import type { UUID } from "@sport-os/shared";
import type { Target1X2 } from "../dataset/types.js";
import type { BinaryProbability, Probability1x2 } from "../probability/types.js";

/**
 * Evaluation Framework — Section 05 §18. Predictive-quality metrics
 * only — deliberately no ROI/realized-profit metric here ("Do not use
 * ROI or realized betting profit as the primary intelligence metric in
 * this section. That belongs primarily to the later performance/
 * backtesting layer."). Every function here is a pure, deterministic
 * calculation over already-produced predictions vs. known outcomes —
 * no I/O, no randomness.
 */

export interface Evaluation1x2Prediction {
  readonly fixtureId: UUID;
  readonly competitionId: UUID;
  readonly seasonId: UUID | undefined;
  readonly predicted: Probability1x2;
  readonly actual: Target1X2;
}

function argmax1x2(p: Probability1x2): Target1X2 {
  if (p.home >= p.draw && p.home >= p.away) return "HOME";
  if (p.away >= p.draw && p.away >= p.home) return "AWAY";
  return "DRAW";
}

function probabilityAtActual(p: Probability1x2, actual: Target1X2): number {
  return actual === "HOME" ? p.home : actual === "DRAW" ? p.draw : p.away;
}

export function accuracy1x2(predictions: readonly Evaluation1x2Prediction[]): number {
  if (predictions.length === 0) return NaN;
  const correct = predictions.filter((p) => argmax1x2(p.predicted) === p.actual).length;
  return correct / predictions.length;
}

export function logLoss1x2(predictions: readonly Evaluation1x2Prediction[]): number {
  if (predictions.length === 0) return NaN;
  const total = predictions.reduce((sum, p) => sum - Math.log(Math.max(probabilityAtActual(p.predicted, p.actual), 1e-12)), 0);
  return total / predictions.length;
}

/** Multiclass Brier score: mean squared distance between the predicted distribution and the one-hot actual outcome, summed across the 3 classes. Range [0, 2]; lower is better. */
export function brierScore1x2(predictions: readonly Evaluation1x2Prediction[]): number {
  if (predictions.length === 0) return NaN;
  const total = predictions.reduce((sum, p) => {
    const home = p.actual === "HOME" ? 1 : 0;
    const draw = p.actual === "DRAW" ? 1 : 0;
    const away = p.actual === "AWAY" ? 1 : 0;
    return sum + (p.predicted.home - home) ** 2 + (p.predicted.draw - draw) ** 2 + (p.predicted.away - away) ** 2;
  }, 0);
  return total / predictions.length;
}

export interface ConfidenceBucketMetric {
  readonly bucketStart: number;
  readonly bucketEnd: number;
  readonly count: number;
  readonly averageConfidence: number;
  readonly accuracy: number;
}

/** Buckets predictions by the CONFIDENCE (probability assigned to the predicted class — the model's own argmax, never the actual outcome), comparing average confidence to observed accuracy in each bucket. The gap between them is what Expected Calibration Error measures — see the naming discipline note in models/types.ts: probability and confidence are related but distinct, and this is exactly where that distinction matters. */
export function calibrationBuckets1x2(predictions: readonly Evaluation1x2Prediction[], numBuckets = 10): readonly ConfidenceBucketMetric[] {
  const buckets: { confidence: number; correct: boolean }[][] = Array.from({ length: numBuckets }, () => []);
  for (const p of predictions) {
    const predictedClass = argmax1x2(p.predicted);
    const confidence = predictedClass === "HOME" ? p.predicted.home : predictedClass === "DRAW" ? p.predicted.draw : p.predicted.away;
    const bucketIndex = Math.min(Math.floor(confidence * numBuckets), numBuckets - 1);
    buckets[bucketIndex]!.push({ confidence, correct: predictedClass === p.actual });
  }

  return buckets.map((entries, i) => ({
    bucketStart: i / numBuckets,
    bucketEnd: (i + 1) / numBuckets,
    count: entries.length,
    averageConfidence: entries.length > 0 ? entries.reduce((s, e) => s + e.confidence, 0) / entries.length : NaN,
    accuracy: entries.length > 0 ? entries.filter((e) => e.correct).length / entries.length : NaN,
  }));
}

/** Expected Calibration Error: sample-weighted average |confidence - accuracy| across buckets — a standard scalar calibration-quality summary. */
export function expectedCalibrationError1x2(predictions: readonly Evaluation1x2Prediction[], numBuckets = 10): number {
  if (predictions.length === 0) return NaN;
  const buckets = calibrationBuckets1x2(predictions, numBuckets);
  const total = buckets.reduce((sum, b) => (b.count > 0 ? sum + b.count * Math.abs(b.averageConfidence - b.accuracy) : sum), 0);
  return total / predictions.length;
}

// ============================================================
// Binary market metrics (BTTS, Over/Under) — same statistical
// substance as the 1X2 metrics above, specialized to two outcomes.
// ============================================================

export interface EvaluationBinaryPrediction {
  readonly fixtureId: UUID;
  readonly predicted: BinaryProbability;
  readonly actual: boolean;
}

export function accuracyBinary(predictions: readonly EvaluationBinaryPrediction[], threshold = 0.5): number {
  if (predictions.length === 0) return NaN;
  const correct = predictions.filter((p) => (p.predicted.yes >= threshold) === p.actual).length;
  return correct / predictions.length;
}

export interface PrecisionRecall {
  readonly precision: number;
  readonly recall: number;
}

export function precisionRecallBinary(predictions: readonly EvaluationBinaryPrediction[], threshold = 0.5): PrecisionRecall {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  for (const p of predictions) {
    const predictedYes = p.predicted.yes >= threshold;
    if (predictedYes && p.actual) truePositive += 1;
    else if (predictedYes && !p.actual) falsePositive += 1;
    else if (!predictedYes && p.actual) falseNegative += 1;
  }
  return {
    precision: truePositive + falsePositive > 0 ? truePositive / (truePositive + falsePositive) : NaN,
    recall: truePositive + falseNegative > 0 ? truePositive / (truePositive + falseNegative) : NaN,
  };
}

export function logLossBinary(predictions: readonly EvaluationBinaryPrediction[]): number {
  if (predictions.length === 0) return NaN;
  const total = predictions.reduce((sum, p) => sum - Math.log(Math.max(p.actual ? p.predicted.yes : p.predicted.no, 1e-12)), 0);
  return total / predictions.length;
}

export function brierScoreBinary(predictions: readonly EvaluationBinaryPrediction[]): number {
  if (predictions.length === 0) return NaN;
  const total = predictions.reduce((sum, p) => sum + (p.predicted.yes - (p.actual ? 1 : 0)) ** 2, 0);
  return total / predictions.length;
}

/**
 * ROC-AUC via the Mann-Whitney U statistic (rank-sum formulation) —
 * exact, and equivalent to trapezoidal-rule integration of the ROC
 * curve without needing to construct one. Ties are handled with average
 * ranks, the standard correction. Undefined (NaN) when every example
 * shares the same actual label, since AUC is meaningless without both
 * classes present — never silently returned as 0.5 or 1.
 */
export function rocAucBinary(predictions: readonly EvaluationBinaryPrediction[]): number {
  const positives = predictions.filter((p) => p.actual);
  const negatives = predictions.filter((p) => !p.actual);
  if (positives.length === 0 || negatives.length === 0) return NaN;

  const ranked = [...predictions].map((p, i) => ({ score: p.predicted.yes, actual: p.actual, originalIndex: i })).sort((a, b) => a.score - b.score);

  const ranks = new Array<number>(ranked.length);
  let i = 0;
  let rank = 1;
  while (i < ranked.length) {
    let j = i;
    while (j + 1 < ranked.length && ranked[j + 1]!.score === ranked[i]!.score) j += 1;
    const averageRank = (rank + (rank + (j - i))) / 2;
    for (let k = i; k <= j; k++) ranks[k] = averageRank;
    rank += j - i + 1;
    i = j + 1;
  }

  let positiveRankSum = 0;
  for (let idx = 0; idx < ranked.length; idx++) {
    if (ranked[idx]!.actual) positiveRankSum += ranks[idx]!;
  }

  const u = positiveRankSum - (positives.length * (positives.length + 1)) / 2;
  return u / (positives.length * negatives.length);
}
