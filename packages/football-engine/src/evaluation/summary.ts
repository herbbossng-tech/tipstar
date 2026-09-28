import type { ISODateString, UUID } from "@sport-os/shared";
import type { TrainingExample } from "../dataset/types.js";
import { FeatureQuality, type FeatureQuality as FeatureQualityType } from "../features/types.js";
import { accuracy1x2, brierScore1x2, calibrationBuckets1x2, expectedCalibrationError1x2, logLoss1x2, type ConfidenceBucketMetric, type Evaluation1x2Prediction } from "./metrics.js";

/**
 * Evaluation run summary — Section 05 §18's "also track" list: sample
 * count, missing-feature rate, data-quality distribution, performance
 * by competition, by season, by confidence bucket. This is the
 * structured object an EvaluationRun (see repositories/intelligence.ts)
 * persists — never just a bare accuracy number.
 */

export interface GroupMetrics {
  readonly sampleCount: number;
  readonly accuracy: number;
  readonly logLoss: number;
  readonly brierScore: number;
}

function groupMetrics(predictions: readonly Evaluation1x2Prediction[]): GroupMetrics {
  return { sampleCount: predictions.length, accuracy: accuracy1x2(predictions), logLoss: logLoss1x2(predictions), brierScore: brierScore1x2(predictions) };
}

function groupBy<T, K extends string>(items: readonly T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const existing = map.get(key);
    if (existing) existing.push(item);
    else map.set(key, [item]);
  }
  return map;
}

export function breakdownByCompetition(predictions: readonly Evaluation1x2Prediction[]): Readonly<Record<string, GroupMetrics>> {
  const grouped = groupBy(predictions, (p) => p.competitionId);
  return Object.fromEntries([...grouped.entries()].map(([competitionId, group]) => [competitionId, groupMetrics(group)]));
}

export function breakdownBySeason(predictions: readonly Evaluation1x2Prediction[], seasonIdByFixtureId: ReadonlyMap<UUID, UUID | undefined>): Readonly<Record<string, GroupMetrics>> {
  const withSeason = predictions.filter((p) => seasonIdByFixtureId.get(p.fixtureId) !== undefined);
  const grouped = groupBy(withSeason, (p) => seasonIdByFixtureId.get(p.fixtureId)!);
  return Object.fromEntries([...grouped.entries()].map(([seasonId, group]) => [seasonId, groupMetrics(group)]));
}

/** Fraction of feature values across `examples` whose dataQuality is MISSING — the honest measure of how much of a dataset's feature matrix is actually populated, never silently hidden inside an aggregate accuracy number. */
export function missingFeatureRate(examples: readonly TrainingExample[]): number {
  let total = 0;
  let missing = 0;
  for (const example of examples) {
    for (const value of Object.values(example.features)) {
      total += 1;
      if (value.dataQuality === FeatureQuality.MISSING) missing += 1;
    }
  }
  return total > 0 ? missing / total : NaN;
}

export function dataQualityDistribution(examples: readonly TrainingExample[]): Readonly<Record<FeatureQualityType, number>> {
  const counts: Record<string, number> = {};
  for (const status of Object.values(FeatureQuality)) counts[status] = 0;
  for (const example of examples) {
    for (const value of Object.values(example.features)) {
      counts[value.dataQuality] = (counts[value.dataQuality] ?? 0) + 1;
    }
  }
  return counts as Record<FeatureQualityType, number>;
}

export interface EvaluationSummary {
  readonly datasetVersion: string;
  readonly modelVersion: string;
  readonly ensembleVersion: string | undefined;
  readonly calibratorVersion: string | undefined;
  readonly sampleCount: number;
  readonly accuracy: number;
  readonly logLoss: number;
  readonly brierScore: number;
  readonly expectedCalibrationError: number;
  readonly calibrationBuckets: readonly ConfidenceBucketMetric[];
  readonly missingFeatureRate: number;
  readonly dataQualityDistribution: Readonly<Record<FeatureQualityType, number>>;
  readonly byCompetition: Readonly<Record<string, GroupMetrics>>;
  readonly bySeason: Readonly<Record<string, GroupMetrics>>;
  readonly evaluatedAt: ISODateString;
}

export interface BuildEvaluationSummaryParams {
  readonly datasetVersion: string;
  readonly modelVersion: string;
  readonly ensembleVersion?: string;
  readonly calibratorVersion?: string;
  readonly predictions: readonly Evaluation1x2Prediction[];
  readonly examples: readonly TrainingExample[];
  readonly now?: () => ISODateString;
}

export function buildEvaluationSummary(params: BuildEvaluationSummaryParams): EvaluationSummary {
  const seasonIdByFixtureId = new Map(params.examples.map((e) => [e.fixtureId, e.seasonId]));
  const now = (params.now ?? (() => new Date().toISOString()))();

  return {
    datasetVersion: params.datasetVersion,
    modelVersion: params.modelVersion,
    ensembleVersion: params.ensembleVersion,
    calibratorVersion: params.calibratorVersion,
    sampleCount: params.predictions.length,
    accuracy: accuracy1x2(params.predictions),
    logLoss: logLoss1x2(params.predictions),
    brierScore: brierScore1x2(params.predictions),
    expectedCalibrationError: expectedCalibrationError1x2(params.predictions),
    calibrationBuckets: calibrationBuckets1x2(params.predictions),
    missingFeatureRate: missingFeatureRate(params.examples),
    dataQualityDistribution: dataQualityDistribution(params.examples),
    byCompetition: breakdownByCompetition(params.predictions),
    bySeason: breakdownBySeason(params.predictions, seasonIdByFixtureId),
    evaluatedAt: now,
  };
}
