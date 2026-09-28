import { generateId } from "@sport-os/shared";
import { describe, expect, it } from "vitest";
import { InMemoryFixturesRepository, InMemoryMatchResultsRepository } from "./fixtures.js";
import { InMemoryOddsObservationsRepository } from "./observations.js";

describe("InMemoryFixturesRepository", () => {
  it("rejects a fixture where home and away team are the same", async () => {
    const repo = new InMemoryFixturesRepository();
    const teamId = generateId();
    await expect(
      repo.upsert({
        competitionId: generateId(),
        seasonId: undefined,
        homeTeamId: teamId,
        awayTeamId: teamId,
        scheduledKickoffAt: "2026-01-10T19:00:00Z",
        status: "scheduled",
        providerStatusRaw: "NS",
        provider: "test",
        providerFixtureId: "F1",
      }),
    ).rejects.toThrow();
  });

  it("upserting the same provider+providerFixtureId twice never creates a second row", async () => {
    const repo = new InMemoryFixturesRepository();
    const input = {
      competitionId: generateId(),
      seasonId: undefined,
      homeTeamId: generateId(),
      awayTeamId: generateId(),
      scheduledKickoffAt: "2026-01-10T19:00:00Z",
      status: "scheduled" as const,
      providerStatusRaw: "NS",
      provider: "test",
      providerFixtureId: "F1",
    };
    const first = await repo.upsert(input);
    const second = await repo.upsert({ ...input, status: "live", providerStatusRaw: "1H" });
    expect(second.id).toBe(first.id);
    expect(second.status).toBe("live");
    // scheduledKickoffAt was never touched by the second upsert.
    expect(second.scheduledKickoffAt).toBe(first.scheduledKickoffAt);
  });
});

describe("InMemoryMatchResultsRepository", () => {
  it("treats a second write for the same fixture as a correction, not a silent overwrite", async () => {
    const repo = new InMemoryMatchResultsRepository();
    const fixtureId = generateId();
    const first = await repo.upsert({ fixtureId, homeGoals: 1, awayGoals: 1, halftimeHomeGoals: 0, halftimeAwayGoals: 0, resultRecordedAt: "2026-01-10T20:55:00Z", source: "test" });
    expect(first.correctionCount).toBe(0);
    expect(first.correctedAt).toBeUndefined();

    const corrected = await repo.upsert({ fixtureId, homeGoals: 2, awayGoals: 1, halftimeHomeGoals: 1, halftimeAwayGoals: 0, resultRecordedAt: "2026-01-10T20:55:00Z", source: "test" });
    expect(corrected.id).toBe(first.id);
    expect(corrected.correctionCount).toBe(1);
    expect(corrected.correctedAt).toBeDefined();
    // The original moment the result first became known is preserved, not overwritten by the correction's own timestamp.
    expect(corrected.resultRecordedAt).toBe(first.resultRecordedAt);
    expect(corrected.homeGoals).toBe(2);
  });
});

describe("InMemoryOddsObservationsRepository", () => {
  it("rejects non-positive odds", async () => {
    const repo = new InMemoryOddsObservationsRepository();
    await expect(
      repo.insert({
        fixtureId: generateId(),
        marketType: "match_result_1x2",
        selection: "home",
        odds: 0,
        bookmakerSource: "test",
        observedAt: "2026-01-10T17:00:00Z",
        providerPublishedAt: undefined,
        temporalReliability: "estimated",
        provider: "test",
        providerObservationId: undefined,
        ingestionRunId: undefined,
      }),
    ).rejects.toThrow();
  });

  it("preserves multiple observations for the same fixture/market/selection — never just the latest", async () => {
    const repo = new InMemoryOddsObservationsRepository();
    const fixtureId = generateId();
    const base = { fixtureId, marketType: "match_result_1x2", selection: "home", bookmakerSource: "test", provider: "test", providerObservationId: undefined, ingestionRunId: undefined, temporalReliability: "confirmed" as const };
    await repo.insert({ ...base, odds: 2.1, observedAt: "2026-01-10T17:00:00Z", providerPublishedAt: "2026-01-10T16:55:00Z" });
    await repo.insert({ ...base, odds: 2.2, observedAt: "2026-01-10T18:00:00Z", providerPublishedAt: "2026-01-10T17:55:00Z" });

    const all = await repo.listForFixture(fixtureId);
    expect(all).toHaveLength(2);
    expect(all.map((o) => o.odds).sort()).toEqual([2.1, 2.2]);
  });
});
