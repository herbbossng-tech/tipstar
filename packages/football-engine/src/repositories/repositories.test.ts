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

  it("listByKickoffWindow returns only fixtures whose scheduledKickoffAt falls inside [from, to], inclusive", async () => {
    const repo = new InMemoryFixturesRepository();
    const make = (providerFixtureId: string, scheduledKickoffAt: string) =>
      repo.upsert({ competitionId: generateId(), seasonId: undefined, homeTeamId: generateId(), awayTeamId: generateId(), scheduledKickoffAt, status: "scheduled", providerStatusRaw: "NS", provider: "sportmonks", providerFixtureId });
    await make("F-before", "2026-01-10T16:00:00Z");
    const inWindow = await make("F-in-window", "2026-01-10T19:00:00Z");
    await make("F-after", "2026-01-11T00:00:00Z");

    const results = await repo.listByKickoffWindow("2026-01-10T18:00:00Z", "2026-01-10T20:00:00Z");
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe(inWindow.id);
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

  describe("fixture identity immutability regression (PR review fix — item 3)", () => {
    it("a repeat sighting reporting a different competition/season/home/away team never rewrites the stored identity", async () => {
      const repo = new InMemoryFixturesRepository();
      const originalCompetitionId = generateId();
      const originalSeasonId = generateId();
      const originalHomeTeamId = generateId();
      const originalAwayTeamId = generateId();
      const input = {
        competitionId: originalCompetitionId,
        seasonId: originalSeasonId,
        homeTeamId: originalHomeTeamId,
        awayTeamId: originalAwayTeamId,
        scheduledKickoffAt: "2026-01-10T19:00:00Z",
        status: "scheduled" as const,
        providerStatusRaw: "NS",
        provider: "identity_test",
        providerFixtureId: "IDENT-1",
      };
      const first = await repo.upsert(input);

      const repeatWithDifferentIdentity = await repo.upsert({
        ...input,
        competitionId: generateId(),
        seasonId: generateId(),
        homeTeamId: generateId(),
        awayTeamId: generateId(),
        status: "live",
        providerStatusRaw: "1H",
      });

      expect(repeatWithDifferentIdentity.id).toBe(first.id);
      // Identity is exactly what it was on first sighting — the repeat
      // sighting's (different) identity fields are ignored entirely.
      expect(repeatWithDifferentIdentity.competitionId).toBe(originalCompetitionId);
      expect(repeatWithDifferentIdentity.seasonId).toBe(originalSeasonId);
      expect(repeatWithDifferentIdentity.homeTeamId).toBe(originalHomeTeamId);
      expect(repeatWithDifferentIdentity.awayTeamId).toBe(originalAwayTeamId);
      // Status DID legitimately change — this repository-level guard is
      // narrowly about identity, not a blanket refusal to update.
      expect(repeatWithDifferentIdentity.status).toBe("live");
    });
  });

  describe("atomic fixture upsert regression (PR review fix — item 1)", () => {
    it("a failed status-observation write leaves NO partial fixture-state mutation on a first sighting", async () => {
      const failure = new Error("simulated history write failure");
      const repo = new InMemoryFixturesRepository(() => {
        throw failure;
      });
      const input = {
        competitionId: generateId(),
        seasonId: undefined,
        homeTeamId: generateId(),
        awayTeamId: generateId(),
        scheduledKickoffAt: "2026-01-10T19:00:00Z",
        status: "scheduled" as const,
        providerStatusRaw: "NS",
        provider: "atomic_test",
        providerFixtureId: "ATOMIC-1",
      };

      await expect(repo.upsert(input)).rejects.toThrow(failure);
      // Nothing committed at all — not even a partially-formed fixture.
      expect(await repo.getByProviderIdentity("atomic_test", "ATOMIC-1")).toBeUndefined();
    });

    it("a failed status-observation write leaves the PRIOR fixture state committed, never the new one, on a repeat sighting", async () => {
      let shouldFail = false;
      const failure = new Error("simulated history write failure");
      const repo = new InMemoryFixturesRepository(() => {
        if (shouldFail) throw failure;
      });
      const input = {
        competitionId: generateId(),
        seasonId: undefined,
        homeTeamId: generateId(),
        awayTeamId: generateId(),
        scheduledKickoffAt: "2026-01-10T19:00:00Z",
        status: "scheduled" as const,
        providerStatusRaw: "NS",
        provider: "atomic_test",
        providerFixtureId: "ATOMIC-2",
      };
      const first = await repo.upsert(input); // succeeds — shouldFail is still false
      expect(first.status).toBe("scheduled");

      shouldFail = true;
      await expect(repo.upsert({ ...input, status: "finished", providerStatusRaw: "FT" })).rejects.toThrow(failure);

      // The failed attempt to transition to "finished" must not have
      // stuck — the fixture is still exactly as the first, successful
      // upsert left it.
      const after = await repo.getByProviderIdentity("atomic_test", "ATOMIC-2");
      expect(after?.status).toBe("scheduled");
      expect(after?.providerStatusRaw).toBe("NS");
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

    it("(c') resolves deterministically when two versions share the EXACT SAME resultRecordedAt — always the most recently inserted one", async () => {
      const repo = new InMemoryMatchResultsRepository();
      const fixtureId = generateId();
      const SAME_TIMESTAMP = "2026-01-10T19:55:00Z";
      await repo.insert({ fixtureId, homeGoals: 1, awayGoals: 1, halftimeHomeGoals: undefined, halftimeAwayGoals: undefined, resultRecordedAt: SAME_TIMESTAMP, source: "test" });
      const secondTied = await repo.insert({ fixtureId, homeGoals: 3, awayGoals: 3, halftimeHomeGoals: undefined, halftimeAwayGoals: undefined, resultRecordedAt: SAME_TIMESTAMP, source: "test" });

      // Called repeatedly to prove the resolution is stable/repeatable,
      // not merely "happened to be right once".
      for (let i = 0; i < 5; i++) {
        const resolved = await repo.getAsOf(fixtureId, SAME_TIMESTAMP);
        expect(resolved?.id).toBe(secondTied.id);
        expect(resolved?.homeGoals).toBe(3);
        expect(resolved?.awayGoals).toBe(3);

        const latest = await repo.getLatest(fixtureId);
        expect(latest?.id).toBe(secondTied.id);
      }
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
