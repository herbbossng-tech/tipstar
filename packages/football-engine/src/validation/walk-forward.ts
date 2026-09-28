import type { ISODateString, UUID } from "@sport-os/shared";
import type { TrainingExample } from "../dataset/types.js";

/**
 * Walk-forward validation — Section 05 §9. Chronological only: never
 * random train/test splitting for temporal football prediction.
 *
 *   TRAIN WINDOW 1 → VALIDATION WINDOW 1 → TEST WINDOW 1
 *   TRAIN WINDOW 2 → VALIDATION WINDOW 2 → TEST WINDOW 2
 *   ...
 *
 * This implementation uses an EXPANDING training window (trainStart is
 * fixed at the dataset's earliest example; trainEnd grows by `stepDays`
 * each window) rather than a rolling fixed-size one — a deliberate,
 * documented choice: with a small dataset, an expanding window uses
 * every available example rather than discarding older ones, and it is
 * the more common convention for walk-forward evaluation in low-data
 * regimes. A rolling window is a legitimate alternative the spec does
 * not mandate; this one is named and testable.
 */

export interface WalkForwardConfig {
  readonly minTrainingPeriodDays: number;
  readonly validationPeriodDays: number;
  readonly testPeriodDays: number;
  /** How far trainEnd advances between successive windows. */
  readonly stepDays: number;
  /** Gap enforced between train/validation and validation/test, guarding against leakage from near-boundary time correlation (e.g. a mid-week and weekend fixture of the same round). */
  readonly embargoDays: number;
  readonly minSamplesPerWindow: number;
  readonly competitionIds?: readonly UUID[];
}

export interface WalkForwardWindow {
  readonly windowIndex: number;
  readonly trainStart: ISODateString;
  /** Exclusive. */
  readonly trainEnd: ISODateString;
  readonly validationStart: ISODateString;
  readonly validationEnd: ISODateString;
  readonly testStart: ISODateString;
  readonly testEnd: ISODateString;
}

export interface WalkForwardSplit {
  readonly window: WalkForwardWindow;
  readonly train: readonly TrainingExample[];
  readonly validation: readonly TrainingExample[];
  readonly test: readonly TrainingExample[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(iso: ISODateString, days: number): ISODateString {
  return new Date(new Date(iso).getTime() + days * DAY_MS).toISOString();
}

function inRange(kickoffTime: ISODateString, startInclusive: ISODateString, endExclusive: ISODateString): boolean {
  const t = new Date(kickoffTime).getTime();
  return t >= new Date(startInclusive).getTime() && t < new Date(endExclusive).getTime();
}

function filterByCompetition(examples: readonly TrainingExample[], competitionIds: readonly UUID[] | undefined): readonly TrainingExample[] {
  if (!competitionIds || competitionIds.length === 0) return examples;
  const set = new Set(competitionIds);
  return examples.filter((e) => set.has(e.competitionId));
}

/**
 * Generates every complete walk-forward window the given examples
 * support under `config`. Returns an empty array (never throws) if the
 * dataset is too small/short to support even one full window under
 * minSamplesPerWindow — "not enough data" is a legitimate, reportable
 * outcome, not an error.
 */
export function generateWalkForwardWindows(examples: readonly TrainingExample[], config: WalkForwardConfig): readonly WalkForwardWindow[] {
  const scoped = filterByCompetition(examples, config.competitionIds);
  if (scoped.length === 0) return [];

  // Never shuffled — examples are assumed already chronological
  // (dataset/builder.ts guarantees this), but sorted defensively so
  // this function is correct even given an out-of-order input.
  const sorted = [...scoped].sort((a, b) => new Date(a.kickoffTime).getTime() - new Date(b.kickoffTime).getTime());
  const earliest = sorted[0]!.kickoffTime;
  const latest = sorted[sorted.length - 1]!.kickoffTime;

  const windows: WalkForwardWindow[] = [];
  let windowIndex = 0;
  let trainEnd = addDays(earliest, config.minTrainingPeriodDays);

  while (true) {
    const validationStart = addDays(trainEnd, config.embargoDays);
    const validationEnd = addDays(validationStart, config.validationPeriodDays);
    const testStart = addDays(validationEnd, config.embargoDays);
    const testEnd = addDays(testStart, config.testPeriodDays);

    if (new Date(testEnd).getTime() > new Date(latest).getTime() + DAY_MS) break;

    const trainCount = sorted.filter((e) => inRange(e.kickoffTime, earliest, trainEnd)).length;
    const validationCount = sorted.filter((e) => inRange(e.kickoffTime, validationStart, validationEnd)).length;
    const testCount = sorted.filter((e) => inRange(e.kickoffTime, testStart, testEnd)).length;

    if (trainCount >= config.minSamplesPerWindow && validationCount >= config.minSamplesPerWindow && testCount >= config.minSamplesPerWindow) {
      windows.push({ windowIndex, trainStart: earliest, trainEnd, validationStart, validationEnd, testStart, testEnd });
      windowIndex += 1;
    }

    trainEnd = addDays(trainEnd, config.stepDays);
  }

  return windows;
}

export function splitExamplesByWindow(examples: readonly TrainingExample[], window: WalkForwardWindow): WalkForwardSplit {
  const sorted = [...examples].sort((a, b) => new Date(a.kickoffTime).getTime() - new Date(b.kickoffTime).getTime());
  return {
    window,
    train: sorted.filter((e) => inRange(e.kickoffTime, window.trainStart, window.trainEnd)),
    validation: sorted.filter((e) => inRange(e.kickoffTime, window.validationStart, window.validationEnd)),
    test: sorted.filter((e) => inRange(e.kickoffTime, window.testStart, window.testEnd)),
  };
}
