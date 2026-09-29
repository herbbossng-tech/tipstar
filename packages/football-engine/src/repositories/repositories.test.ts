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

  describe("getByIdAsOf — Mutable Fixture Status Leakage regression (PR review fix)", () => {
    const KICKOFF = "2026-01-10T19:00:00Z";
    const SCHEDULED_OBSERVED_AT = "2026-01-10T17:00:00Z";
    const LIVE_OBSERVED_AT = "2026-01-10T19:05:00Z";
    const FINISHED_OBSERVED_AT = "2026-01-10T20:55:00Z";

    // Each upsert() call supplies an explicit `observedAt`, mirroring a
    // real ingestion poll's timestamp — this drives the fixed test
    // timeline deterministically instead of relying on wall-clock "now".
    async function buildTransitioningFixture() {
      const repo = new InMemoryFixturesRepository();
      const input = {
        competitionId: generateId(),
        seasonId: undefined,
        homeTeamId: generateId(),
        awayTeamId: generateId(),
        scheduledKickoffAt: KICKOFF,
        status: "scheduled" as const,
        providerStatusRaw: "NS",
        provider: "status_leakage_test",
        providerFixtureId: "STATUS-1",
      };
      const scheduled = await repo.upsert({ ...input, observedAt: SCHEDULED_OBSERVED_AT });
      const live = await repo.upsert({ ...input, status: "live", providerStatusRaw: "1H", observedAt: LIVE_OBSERVED_AT });
      const finished = await repo.upsert({ ...input, status: "finished", providerStatusRaw: "FT", observedAt: FINISHED_OBSERVED_AT });
      return { repo, fixtureId: scheduled.id, live, finished };
    }

    it("(a) a pre-match snapshot sees scheduled", async () => {
      const { repo, fixtureId } = await buildTransitioningFixture();
      const snapshot = await repo.getByIdAsOf(fixtureId, "2026-01-10T18:00:00Z");
      expect(snapshot?.status).toBe("scheduled");
    });

    it("(b) a later snapshot sees live/finished once those versions are known", async () => {
      const { repo, fixtureId } = await buildTransitioningFixture();
      expect((await repo.getByIdAsOf(fixtureId, "2026-01-10T19:30:00Z"))?.status).toBe("live");
      expect((await repo.getByIdAsOf(fixtureId, "2026-01-10T21:00:00Z"))?.status).toBe("finished");
    });

    it("(c) a future status never appears in an earlier snapshot", async () => {
      const { repo, fixtureId } = await buildTransitioningFixture();
      // All three transitions already exist in the repository — the
      // guarantee under test is that asOf, not insertion order or
      // wall-clock time, controls what's visible.
      expect((await repo.getByIdAsOf(fixtureId, "2026-01-10T18:00:00Z"))?.status).toBe("scheduled");
      expect((await repo.getByIdAsOf(fixtureId, "2026-01-10T19:30:00Z"))?.status).toBe("live");
    });

    it("(d) multiple status transitions resolve correctly by asOf", async () => {
      const { repo, fixtureId } = await buildTransitioningFixture();
      expect((await repo.getByIdAsOf(fixtureId, "2026-01-10T18:00:00Z"))?.status).toBe("scheduled");
      expect((await repo.getByIdAsOf(fixtureId, "2026-01-10T19:30:00Z"))?.status).toBe("live");
      expect((await repo.getByIdAsOf(fixtureId, "2026-01-10T21:00:00Z"))?.status).toBe("finished");
    });

    it("getById (current state) reflects the latest status, unlike getByIdAsOf at an earlier time", async () => {
      const { repo, fixtureId } = await buildTransitioningFixture();
      expect((await repo.getById(fixtureId))?.status).toBe("finished");
      expect((await repo.getByIdAsOf(fixtureId, "2026-01-10T18:00:00Z"))?.status).toBe("scheduled");
    });

    it("returns undefined for an unknown fixture id", async () => {
      const repo = new InMemoryFixturesRepository();
      expect(await repo.getByIdAsOf(generateId(), "2026-01-10T18:00:00Z")).toBeUndefined();
    });
  });
});

describe("InMemoryMatchResultsRepository", () => {
  it("treats a second write for the same fixture as a correction — a NEW version, never a silent overwrite", async () => {
    const repo = new InMemoryMatchResultsRepository();
    const fixtureId = generateId();
    const first = await repo.insert({ fixtureId, homeGoals: 1, awayGoals: 1, halftimeHomeGoals: 0, halftimeAwayGoals: 0, resultRecordedAt: "2026-01-10T19:55:00Z", source: "test" });
    expect(first.correctionCount).toBe(0);
    expect(first.correctedAt).toBeUndefined();

    const corrected = await repo.insert({ fixtureId, homeGoals: 2, awayGoals: 1, halftimeHomeGoals: 1, halftimeAwayGoals: 0, resultRecordedAt: "2026-01-10T20:30:00Z", source: "test" });
    // A correction is its OWN row — never the same id as the version it corrects.
    expect(corrected.id).not.toBe(first.id);
    expect(corrected.correctionCount).toBe(1);
    expect(corrected.correctedAt).toBeDefined();
    // Each version's resultRecordedAt is its OWN — never inherited from
    // an earlier version. (This is the exact fix: the prior design
    // preserved the ORIGINAL resultRecordedAt across a correction, which
    // let the corrected score leak through the original timestamp on any
    // historical point-in-time query.)
    expect(corrected.resultRecordedAt).toBe("2026-01-10T20:30:00Z");
    expect(first.resultRecordedAt).toBe("2026-01-10T19:55:00Z");
    expect(corrected.homeGoals).toBe(2);
  });

  describe("getAsOf — Match Result Correction Leakage regression (PR review fix)", () => {
    const KICKOFF = "2026-01-10T19:00:00Z";
    const SNAPSHOT_TIME = "2026-01-10T18:00:00Z"; // pre-kickoff — before either version
    const ORIGINAL_RECORDED_AT = "2026-01-10T19:55:00Z"; // original result becomes known
    const CORRECTED_RECORDED_AT = "2026-01-10T20:30:00Z"; // provider correction becomes known
    const POST_CORRECTION_SNAPSHOT = "2026-01-10T21:00:00Z";

    async function buildCorrectedFixture() {
      const repo = new InMemoryMatchResultsRepository();
      const fixtureId = generateId();
      const original = await repo.insert({ fixtureId, homeGoals: 1, awayGoals: 1, halftimeHomeGoals: 0, halftimeAwayGoals: 0, resultRecordedAt: ORIGINAL_RECORDED_AT, source: "test" });
      const corrected = await repo.insert({ fixtureId, homeGoals: 2, awayGoals: 1, halftimeHomeGoals: 1, halftimeAwayGoals: 0, resultRecordedAt: CORRECTED_RECORDED_AT, source: "test" });
      return { repo, fixtureId, original, corrected };
    }

    it("(a) a pre-correction snapshot sees the original result", async () => {
      const { repo, fixtureId } = await buildCorrectedFixture();
      // A snapshot taken between the original and the correction.
      const snapshot = await repo.getAsOf(fixtureId, "2026-01-10T20:00:00Z");
      expect(snapshot?.homeGoals).toBe(1);
      expect(snapshot?.awayGoals).toBe(1);
    });

    it("(b) a post-correction snapshot sees the corrected result", async () => {
      const { repo, fixtureId } = await buildCorrectedFixture();
      const snapshot = await repo.getAsOf(fixtureId, POST_CORRECTION_SNAPSHOT);
      expect(snapshot?.homeGoals).toBe(2);
      expect(snapshot?.awayGoals).toBe(1);
    });

    it("(c) the correction cannot alter the earlier snapshot — kickoff-time snapshot still sees no result at all", async () => {
      const { repo, fixtureId } = await buildCorrectedFixture();
      // Taken AFTER both versions already exist in the repository — the
      // guarantee under test is that asOf, not insertion order or
      // wall-clock time, controls what's visible.
      const snapshot = await repo.getAsOf(fixtureId, SNAPSHOT_TIME);
      expect(snapshot).toBeUndefined();
      // A snapshot right after the original (but before the correction)
      // must also be provably unaffected by the later correction.
      const midSnapshot = await repo.getAsOf(fixtureId, "2026-01-10T19:56:00Z");
      expect(midSnapshot?.homeGoals).toBe(1);
      expect(midSnapshot?.awayGoals).toBe(1);
    });

    it("(d) multiple corrections resolve correctly by asOf", async () => {
      const repo = new InMemoryMatchResultsRepository();
      const fixtureId = generateId();
      await repo.insert({ fixtureId, homeGoals: 1, awayGoals: 0, halftimeHomeGoals: undefined, halftimeAwayGoals: undefined, resultRecordedAt: "2026-01-10T19:55:00Z", source: "test" });
      await repo.insert({ fixtureId, homeGoals: 1, awayGoals: 1, halftimeHomeGoals: undefined, halftimeAwayGoals: undefined, resultRecordedAt: "2026-01-10T20:15:00Z", source: "test" });
      const third = await repo.insert({ fixtureId, homeGoals: 2, awayGoals: 1, halftimeHomeGoals: undefined, halftimeAwayGoals: undefined, resultRecordedAt: "2026-01-10T20:45:00Z", source: "test" });
      expect(third.correctionCount).toBe(2);

      expect(await repo.getAsOf(fixtureId, KICKOFF)).toBeUndefined();
      expect((await repo.getAsOf(fixtureId, "2026-01-10T20:00:00Z"))?.homeGoals).toBe(1);
      expect((await repo.getAsOf(fixtureId, "2026-01-10T20:00:00Z"))?.awayGoals).toBe(0);
      expect((await repo.getAsOf(fixtureId, "2026-01-10T20:20:00Z"))?.awayGoals).toBe(1);
      expect((await repo.getAsOf(fixtureId, "2026-01-10T20:20:00Z"))?.homeGoals).toBe(1);
      expect((await repo.getAsOf(fixtureId, "2026-01-10T21:00:00Z"))?.homeGoals).toBe(2);
    });

    it("getLatest (current state) reflects the latest version, unlike getAsOf at an earlier time", async () => {
      const { repo, fixtureId } = await buildCorrectedFixture();
      expect((await repo.getLatest(fixtureId))?.homeGoals).toBe(2);
      expect(await repo.getAsOf(fixtureId, SNAPSHOT_TIME)).toBeUndefined();
    });
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
