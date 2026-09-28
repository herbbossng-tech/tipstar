import { generateId } from "@sport-os/shared";
import { describe, expect, it } from "vitest";
import { InMemoryFixturesRepository, InMemoryMatchResultsRepository } from "../repositories/fixtures.js";
import { InMemoryOddsObservationsRepository } from "../repositories/observations.js";
import { buildTrainingDataset } from "./builder.js";
import { Target1X2 } from "./types.js";

/** SYNTHETIC — deterministic fixtures/results used only to validate dataset construction. */
async function seed() {
  const fixtures = new InMemoryFixturesRepository();
  const matchResults = new InMemoryMatchResultsRepository();
  const oddsObservations = new InMemoryOddsObservationsRepository();
  const competitionId = generateId();
  const teamA = generateId();
  const teamB = generateId();

  const homeWin = await fixtures.upsert({ competitionId, seasonId: undefined, homeTeamId: teamA, awayTeamId: teamB, scheduledKickoffAt: "2026-01-05T15:00:00Z", status: "finished", providerStatusRaw: "FT", provider: "dataset_test", providerFixtureId: "home-win" });
  await matchResults.upsert({ fixtureId: homeWin.id, homeGoals: 2, awayGoals: 0, halftimeHomeGoals: undefined, halftimeAwayGoals: undefined, resultRecordedAt: "2026-01-05T17:00:00Z", source: "dataset_test" });

  const draw = await fixtures.upsert({ competitionId, seasonId: undefined, homeTeamId: teamB, awayTeamId: teamA, scheduledKickoffAt: "2026-01-12T15:00:00Z", status: "finished", providerStatusRaw: "FT", provider: "dataset_test", providerFixtureId: "draw" });
  await matchResults.upsert({ fixtureId: draw.id, homeGoals: 1, awayGoals: 1, halftimeHomeGoals: undefined, halftimeAwayGoals: undefined, resultRecordedAt: "2026-01-12T17:00:00Z", source: "dataset_test" });

  const noResult = await fixtures.upsert({ competitionId, seasonId: undefined, homeTeamId: teamA, awayTeamId: teamB, scheduledKickoffAt: "2026-01-19T15:00:00Z", status: "scheduled", providerStatusRaw: "NS", provider: "dataset_test", providerFixtureId: "no-result-yet" });

  return { fixtures, matchResults, oddsObservations, homeWin, draw, noResult };
}

describe("buildTrainingDataset", () => {
  it("derives correct 1X2/BTTS/total-goals labels from each fixture's real match result", async () => {
    const { fixtures, matchResults, oddsObservations, homeWin, draw } = await seed();
    const dataset = await buildTrainingDataset(
      { fixtures, matchResults, oddsObservations },
      { fixtures: [homeWin, draw], snapshotLeadTimeMinutes: 60, datasetVersion: "test-v1", sourceVersion: "dataset_test", now: () => "2026-02-01T00:00:00Z" },
    );

    expect(dataset.examples).toHaveLength(2);
    const homeWinExample = dataset.examples.find((e) => e.fixtureId === homeWin.id)!;
    expect(homeWinExample.target1x2).toBe(Target1X2.HOME);
    expect(homeWinExample.targetTotalGoals).toBe(2);
    expect(homeWinExample.targetBtts).toBe(false);

    const drawExample = dataset.examples.find((e) => e.fixtureId === draw.id)!;
    expect(drawExample.target1x2).toBe(Target1X2.DRAW);
    expect(drawExample.targetTotalGoals).toBe(2);
    expect(drawExample.targetBtts).toBe(true);
  });

  it("excludes (never silently drops) a fixture with no match result", async () => {
    const { fixtures, matchResults, oddsObservations, homeWin, noResult } = await seed();
    const dataset = await buildTrainingDataset({ fixtures, matchResults, oddsObservations }, { fixtures: [homeWin, noResult], snapshotLeadTimeMinutes: 60, datasetVersion: "test-v1", sourceVersion: "dataset_test" });

    expect(dataset.examples).toHaveLength(1);
    expect(dataset.excluded).toHaveLength(1);
    expect(dataset.excluded[0]!.fixtureId).toBe(noResult.id);
    expect(dataset.excluded[0]!.reason).toContain("No match result");
  });

  it("every example's snapshotTime is strictly before its kickoffTime", async () => {
    const { fixtures, matchResults, oddsObservations, homeWin, draw } = await seed();
    const dataset = await buildTrainingDataset({ fixtures, matchResults, oddsObservations }, { fixtures: [homeWin, draw], snapshotLeadTimeMinutes: 30, datasetVersion: "test-v1", sourceVersion: "dataset_test" });

    for (const example of dataset.examples) {
      expect(new Date(example.snapshotTime).getTime()).toBeLessThan(new Date(example.kickoffTime).getTime());
    }
  });

  it("orders examples chronologically by kickoff regardless of input order", async () => {
    const { fixtures, matchResults, oddsObservations, homeWin, draw } = await seed();
    // Pass them in reverse chronological order deliberately.
    const dataset = await buildTrainingDataset({ fixtures, matchResults, oddsObservations }, { fixtures: [draw, homeWin], snapshotLeadTimeMinutes: 60, datasetVersion: "test-v1", sourceVersion: "dataset_test" });

    expect(dataset.examples[0]!.fixtureId).toBe(homeWin.id);
    expect(dataset.examples[1]!.fixtureId).toBe(draw.id);
  });
});
