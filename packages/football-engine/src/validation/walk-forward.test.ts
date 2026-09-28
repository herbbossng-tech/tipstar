import { generateId } from "@sport-os/shared";
import { describe, expect, it } from "vitest";
import type { TrainingExample } from "../dataset/types.js";
import { Target1X2 } from "../dataset/types.js";
import { generateWalkForwardWindows, splitExamplesByWindow, type WalkForwardConfig } from "./walk-forward.js";

/** SYNTHETIC — one fixture every day for 40 days, used only to validate the walk-forward splitter's mechanics. */
function buildSyntheticExamples(count: number): TrainingExample[] {
  const competitionId = generateId();
  const examples: TrainingExample[] = [];
  for (let i = 0; i < count; i++) {
    const kickoff = new Date(Date.UTC(2026, 0, 1 + i, 15, 0, 0)).toISOString();
    examples.push({
      fixtureId: generateId(),
      competitionId,
      seasonId: undefined,
      kickoffTime: kickoff,
      snapshotTime: new Date(new Date(kickoff).getTime() - 60 * 60 * 1000).toISOString(),
      features: {},
      target1x2: Target1X2.HOME,
      targetTotalGoals: 2,
      targetBtts: false,
      datasetVersion: "walk-forward-test",
      builtAt: kickoff,
    });
  }
  return examples;
}

const BASE_CONFIG: WalkForwardConfig = {
  minTrainingPeriodDays: 10,
  validationPeriodDays: 5,
  testPeriodDays: 5,
  stepDays: 5,
  embargoDays: 0,
  minSamplesPerWindow: 1,
};

describe("generateWalkForwardWindows", () => {
  it("never produces a window whose validation/test period starts before its own training period ends", () => {
    const examples = buildSyntheticExamples(40);
    const windows = generateWalkForwardWindows(examples, BASE_CONFIG);
    expect(windows.length).toBeGreaterThan(0);
    for (const w of windows) {
      expect(new Date(w.validationStart).getTime()).toBeGreaterThanOrEqual(new Date(w.trainEnd).getTime());
      expect(new Date(w.testStart).getTime()).toBeGreaterThanOrEqual(new Date(w.validationEnd).getTime());
    }
  });

  it("produces strictly growing training windows across successive indices (expanding window)", () => {
    const examples = buildSyntheticExamples(40);
    const windows = generateWalkForwardWindows(examples, BASE_CONFIG);
    for (let i = 1; i < windows.length; i++) {
      expect(new Date(windows[i]!.trainEnd).getTime()).toBeGreaterThan(new Date(windows[i - 1]!.trainEnd).getTime());
      // trainStart is fixed (expanding window), not advancing.
      expect(windows[i]!.trainStart).toBe(windows[0]!.trainStart);
    }
  });

  it("returns an empty array rather than throwing when there is not enough data for one window", () => {
    const examples = buildSyntheticExamples(3);
    const windows = generateWalkForwardWindows(examples, BASE_CONFIG);
    expect(windows).toEqual([]);
  });

  it("respects minSamplesPerWindow — a window is only emitted if every segment meets the threshold", () => {
    const examples = buildSyntheticExamples(40);
    const strict: WalkForwardConfig = { ...BASE_CONFIG, minSamplesPerWindow: 1000 };
    expect(generateWalkForwardWindows(examples, strict)).toEqual([]);
  });

  it("applies the competition filter before generating windows", () => {
    const examples = buildSyntheticExamples(40);
    const otherCompetitionId = generateId();
    const windows = generateWalkForwardWindows(examples, { ...BASE_CONFIG, competitionIds: [otherCompetitionId] });
    expect(windows).toEqual([]);
  });
});

describe("splitExamplesByWindow", () => {
  it("partitions examples into non-overlapping, chronologically correct train/validation/test sets", () => {
    const examples = buildSyntheticExamples(40);
    const windows = generateWalkForwardWindows(examples, BASE_CONFIG);
    expect(windows.length).toBeGreaterThan(0);
    const split = splitExamplesByWindow(examples, windows[0]!);

    expect(split.train.length + split.validation.length + split.test.length).toBeLessThanOrEqual(examples.length);
    expect(split.train.length).toBeGreaterThan(0);
    expect(split.validation.length).toBeGreaterThan(0);
    expect(split.test.length).toBeGreaterThan(0);

    const lastTrainKickoff = Math.max(...split.train.map((e) => new Date(e.kickoffTime).getTime()));
    const firstValidationKickoff = Math.min(...split.validation.map((e) => new Date(e.kickoffTime).getTime()));
    const lastValidationKickoff = Math.max(...split.validation.map((e) => new Date(e.kickoffTime).getTime()));
    const firstTestKickoff = Math.min(...split.test.map((e) => new Date(e.kickoffTime).getTime()));

    expect(firstValidationKickoff).toBeGreaterThan(lastTrainKickoff);
    expect(firstTestKickoff).toBeGreaterThan(lastValidationKickoff);
  });

  it("never shuffles — split segments preserve chronological order", () => {
    const examples = buildSyntheticExamples(40);
    const windows = generateWalkForwardWindows(examples, BASE_CONFIG);
    const split = splitExamplesByWindow(examples, windows[0]!);
    for (const segment of [split.train, split.validation, split.test]) {
      for (let i = 1; i < segment.length; i++) {
        expect(new Date(segment[i]!.kickoffTime).getTime()).toBeGreaterThanOrEqual(new Date(segment[i - 1]!.kickoffTime).getTime());
      }
    }
  });
});
