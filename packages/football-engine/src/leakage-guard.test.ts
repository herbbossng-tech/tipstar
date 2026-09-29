import { generateId, isErr, isOk } from "@sport-os/shared";
import { describe, expect, it } from "vitest";
import { LeakageType, computePreMatchSnapshotTime, getDataAsOf, type LeakageGuardDependencies } from "./leakage-guard.js";
import { InMemoryFixturesRepository, InMemoryMatchEventsRepository, InMemoryMatchResultsRepository } from "./repositories/fixtures.js";
import { InMemoryOddsObservationsRepository, InMemoryTeamObservationsRepository, type OddsObservationsRepository, type TeamObservationsRepository } from "./repositories/observations.js";
import type { MatchEvent, OddsObservation, TeamObservation } from "./canonical.js";

/**
 * THE LEAKAGE REGRESSION TEST (Section 04 — "must remain permanently").
 * Exact scenario from the Master Blueprint: a fixture kicking off at
 * 2026-01-10T19:00:00Z, a pre-match snapshot taken at 18:00, with
 * observations at 17:00/17:30/17:45 that must be visible and
 * observations at 18:15/21:00 that must never be.
 *
 * Do not weaken, remove, or "simplify" this test. If a future change to
 * LeakageGuard or the repositories' `*AsOf` methods breaks it, that is
 * the change that is wrong, not the test.
 */
describe("LeakageGuard — permanent leakage regression test", () => {
  const KICKOFF = "2026-01-10T19:00:00Z";
  const SNAPSHOT_TIME = "2026-01-10T18:00:00Z";
  const AVAILABLE_TIMES = ["2026-01-10T17:00:00Z", "2026-01-10T17:30:00Z", "2026-01-10T17:45:00Z"];
  const UNAVAILABLE_TIMES = ["2026-01-10T18:15:00Z", "2026-01-10T21:00:00Z"];

  async function buildScenario() {
    const fixtures = new InMemoryFixturesRepository();
    const matchResults = new InMemoryMatchResultsRepository();
    const matchEvents = new InMemoryMatchEventsRepository();
    const teamObservations = new InMemoryTeamObservationsRepository();
    const oddsObservations = new InMemoryOddsObservationsRepository();

    const competitionId = generateId();
    const homeTeamId = generateId();
    const awayTeamId = generateId();

    const fixture = await fixtures.upsert({
      competitionId,
      seasonId: undefined,
      homeTeamId,
      awayTeamId,
      scheduledKickoffAt: KICKOFF,
      status: "scheduled",
      providerStatusRaw: "NS",
      provider: "leakage_regression_test",
      providerFixtureId: "LEAK-REG-1",
      // Well before SNAPSHOT_TIME — getDataAsOf now resolves fixture
      // status point-in-time (getByIdAsOf), so the initial "scheduled"
      // observation must be known as of the snapshot for these
      // assertions to reach the observation/result/event checks at all.
      observedAt: "2026-01-10T10:00:00Z",
    });

    for (const observedAt of AVAILABLE_TIMES) {
      await teamObservations.insert({
        teamId: homeTeamId,
        fixtureId: fixture.id,
        competitionId,
        observationType: "form",
        metrics: { observedAt },
        observedAt,
        providerPublishedAt: undefined,
        sourceUpdatedAt: undefined,
        provider: "leakage_regression_test",
        providerObservationId: undefined,
        ingestionRunId: undefined,
      });
      await oddsObservations.insert({
        fixtureId: fixture.id,
        marketType: "match_result_1x2",
        selection: "home",
        odds: 2.0,
        bookmakerSource: "test_bookmaker",
        observedAt,
        providerPublishedAt: observedAt,
        temporalReliability: "confirmed",
        provider: "leakage_regression_test",
        providerObservationId: undefined,
        ingestionRunId: undefined,
      });
    }

    for (const observedAt of UNAVAILABLE_TIMES) {
      await teamObservations.insert({
        teamId: homeTeamId,
        fixtureId: fixture.id,
        competitionId,
        observationType: "form",
        metrics: { observedAt },
        observedAt,
        providerPublishedAt: undefined,
        sourceUpdatedAt: undefined,
        provider: "leakage_regression_test",
        providerObservationId: undefined,
        ingestionRunId: undefined,
      });
      await oddsObservations.insert({
        fixtureId: fixture.id,
        marketType: "match_result_1x2",
        selection: "home",
        odds: 2.0,
        bookmakerSource: "test_bookmaker",
        observedAt,
        providerPublishedAt: observedAt,
        temporalReliability: "confirmed",
        provider: "leakage_regression_test",
        providerObservationId: undefined,
        ingestionRunId: undefined,
      });
    }

    // The result becomes known well after the snapshot — must never appear in it.
    await matchResults.insert({
      fixtureId: fixture.id,
      homeGoals: 2,
      awayGoals: 1,
      halftimeHomeGoals: 1,
      halftimeAwayGoals: 0,
      resultRecordedAt: "2026-01-10T20:55:00Z",
      source: "leakage_regression_test",
    });

    const deps: LeakageGuardDependencies = { fixtures, matchResults, matchEvents, teamObservations, oddsObservations };
    return { deps, fixture };
  }

  it("returns exactly the observations available before the snapshot, and none after", async () => {
    const { deps, fixture } = await buildScenario();

    const result = await getDataAsOf(deps, fixture.id, SNAPSHOT_TIME);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    const snapshot = result.value;
    expect(snapshot.homeTeamObservations).toHaveLength(3);
    expect(snapshot.awayTeamObservations).toHaveLength(0);
    expect(snapshot.oddsObservations).toHaveLength(3);

    const observedTimes = snapshot.homeTeamObservations.map((o) => o.observedAt);
    for (const time of AVAILABLE_TIMES) expect(observedTimes).toContain(time);
    for (const time of UNAVAILABLE_TIMES) expect(observedTimes).not.toContain(time);

    const oddsObservedTimes = snapshot.oddsObservations.map((o) => o.observedAt);
    for (const time of AVAILABLE_TIMES) expect(oddsObservedTimes).toContain(time);
    for (const time of UNAVAILABLE_TIMES) expect(oddsObservedTimes).not.toContain(time);

    for (const observation of [...snapshot.homeTeamObservations, ...snapshot.oddsObservations]) {
      expect(new Date(observation.observedAt).getTime()).toBeLessThanOrEqual(new Date(SNAPSHOT_TIME).getTime());
    }
  });

  it("excludes the match result — it was not recorded until after the snapshot", async () => {
    const { deps, fixture } = await buildScenario();
    const result = await getDataAsOf(deps, fixture.id, SNAPSHOT_TIME);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.matchResult).toBeUndefined();
  });

  it("includes the match result once the snapshot is taken after it was recorded", async () => {
    const { deps, fixture } = await buildScenario();
    const result = await getDataAsOf(deps, fixture.id, "2026-01-10T21:00:00Z");
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.matchResult?.homeGoals).toBe(2);
    expect(result.value.matchResult?.awayGoals).toBe(1);
  });
});

describe("LeakageGuard — Match Result Correction Leakage regression (PR review fix)", () => {
  // The exact scenario from the PR review: an original result observed
  // right after full time, corrected ~35 minutes later. A pre-match
  // snapshot must never see either; a snapshot between the two must see
  // only the original; a snapshot after the correction must see the
  // corrected score — never leaking through the original's timestamp.
  const KICKOFF = "2026-01-10T19:00:00Z";
  const PRE_MATCH_SNAPSHOT = "2026-01-10T18:00:00Z";
  const ORIGINAL_RECORDED_AT = "2026-01-10T19:55:00Z";
  const POST_ORIGINAL_SNAPSHOT = "2026-01-10T20:00:00Z";
  const CORRECTED_RECORDED_AT = "2026-01-10T20:30:00Z";
  const POST_CORRECTION_SNAPSHOT = "2026-01-10T21:00:00Z";

  async function buildCorrectedScenario() {
    const fixtures = new InMemoryFixturesRepository();
    const matchResults = new InMemoryMatchResultsRepository();
    const matchEvents = new InMemoryMatchEventsRepository();
    const teamObservations = new InMemoryTeamObservationsRepository();
    const oddsObservations = new InMemoryOddsObservationsRepository();

    const fixture = await fixtures.upsert({
      competitionId: generateId(),
      seasonId: undefined,
      homeTeamId: generateId(),
      awayTeamId: generateId(),
      scheduledKickoffAt: KICKOFF,
      status: "scheduled",
      providerStatusRaw: "NS",
      provider: "correction_leakage_test",
      providerFixtureId: "CORR-1",
      observedAt: "2026-01-10T10:00:00Z",
    });

    await matchResults.insert({ fixtureId: fixture.id, homeGoals: 1, awayGoals: 1, halftimeHomeGoals: 0, halftimeAwayGoals: 0, resultRecordedAt: ORIGINAL_RECORDED_AT, source: "correction_leakage_test" });
    await matchResults.insert({ fixtureId: fixture.id, homeGoals: 2, awayGoals: 1, halftimeHomeGoals: 1, halftimeAwayGoals: 0, resultRecordedAt: CORRECTED_RECORDED_AT, source: "correction_leakage_test" });

    const deps: LeakageGuardDependencies = { fixtures, matchResults, matchEvents, teamObservations, oddsObservations };
    return { deps, fixture };
  }

  it("a pre-match snapshot sees no result at all", async () => {
    const { deps, fixture } = await buildCorrectedScenario();
    const result = await getDataAsOf(deps, fixture.id, PRE_MATCH_SNAPSHOT);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.matchResult).toBeUndefined();
  });

  it("a snapshot after the original but before the correction sees only the original score", async () => {
    const { deps, fixture } = await buildCorrectedScenario();
    const result = await getDataAsOf(deps, fixture.id, POST_ORIGINAL_SNAPSHOT);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.matchResult?.homeGoals).toBe(1);
    expect(result.value.matchResult?.awayGoals).toBe(1);
  });

  it("a snapshot after the correction sees the corrected score", async () => {
    const { deps, fixture } = await buildCorrectedScenario();
    const result = await getDataAsOf(deps, fixture.id, POST_CORRECTION_SNAPSHOT);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.matchResult?.homeGoals).toBe(2);
    expect(result.value.matchResult?.awayGoals).toBe(1);
  });

  it("the correction never alters what an earlier snapshot sees, even when queried after the correction exists", async () => {
    const { deps, fixture } = await buildCorrectedScenario();
    // Both the corrected version and this query happen "after" the
    // correction was inserted — the guarantee under test is that
    // snapshotTime, not insertion order, controls the result.
    const result = await getDataAsOf(deps, fixture.id, POST_ORIGINAL_SNAPSHOT);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.matchResult?.homeGoals).toBe(1);
  });
});

describe("LeakageGuard — Mutable Fixture Status Leakage regression (PR review fix)", () => {
  // The exact scenario from the PR review: a fixture scheduled at 19:00,
  // a pre-match snapshot at 18:00 (status known then: scheduled), the
  // match going live at 19:05 and finishing at 20:55. A pre-match
  // snapshot must never see a status the fixture only reached later.
  const KICKOFF = "2026-01-10T19:00:00Z";

  async function buildTransitioningScenario() {
    const fixtures = new InMemoryFixturesRepository();
    const matchResults = new InMemoryMatchResultsRepository();
    const matchEvents = new InMemoryMatchEventsRepository();
    const teamObservations = new InMemoryTeamObservationsRepository();
    const oddsObservations = new InMemoryOddsObservationsRepository();

    const input = {
      competitionId: generateId(),
      seasonId: undefined,
      homeTeamId: generateId(),
      awayTeamId: generateId(),
      scheduledKickoffAt: KICKOFF,
      status: "scheduled" as const,
      providerStatusRaw: "NS",
      provider: "status_leakage_test",
      providerFixtureId: "STATUS-LEAK-1",
    };
    const fixture = await fixtures.upsert({ ...input, observedAt: "2026-01-10T17:00:00Z" });
    await fixtures.upsert({ ...input, status: "live", providerStatusRaw: "1H", observedAt: "2026-01-10T19:05:00Z" });
    await fixtures.upsert({ ...input, status: "finished", providerStatusRaw: "FT", observedAt: "2026-01-10T20:55:00Z" });

    const deps: LeakageGuardDependencies = { fixtures, matchResults, matchEvents, teamObservations, oddsObservations };
    return { deps, fixture };
  }

  it("a pre-match snapshot sees scheduled — never a status the fixture only reached later", async () => {
    const { deps, fixture } = await buildTransitioningScenario();
    const result = await getDataAsOf(deps, fixture.id, "2026-01-10T18:00:00Z");
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.fixture.status).toBe("scheduled");
  });

  it("an in-play snapshot sees live, not finished", async () => {
    const { deps, fixture } = await buildTransitioningScenario();
    const result = await getDataAsOf(deps, fixture.id, "2026-01-10T19:30:00Z");
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.fixture.status).toBe("live");
  });

  it("a post-match snapshot sees finished", async () => {
    const { deps, fixture } = await buildTransitioningScenario();
    const result = await getDataAsOf(deps, fixture.id, "2026-01-10T21:00:00Z");
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.fixture.status).toBe("finished");
  });

  it("the fixture's OTHER fields (identity, scheduledKickoffAt) remain intact on a point-in-time snapshot", async () => {
    const { deps, fixture } = await buildTransitioningScenario();
    const result = await getDataAsOf(deps, fixture.id, "2026-01-10T18:00:00Z");
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.fixture.id).toBe(fixture.id);
    expect(result.value.fixture.scheduledKickoffAt).toBe(KICKOFF);
  });
});

describe("LeakageGuard — adversarial future information test", () => {
  const KICKOFF = "2026-01-10T19:00:00Z";
  const SNAPSHOT_TIME = "2026-01-10T18:00:00Z";

  async function baseFixture() {
    const fixtures = new InMemoryFixturesRepository();
    const competitionId = generateId();
    const homeTeamId = generateId();
    const awayTeamId = generateId();
    const fixture = await fixtures.upsert({
      competitionId,
      seasonId: undefined,
      homeTeamId,
      awayTeamId,
      scheduledKickoffAt: KICKOFF,
      status: "scheduled",
      providerStatusRaw: "NS",
      provider: "adversarial_test",
      providerFixtureId: "ADV-1",
      observedAt: "2026-01-10T10:00:00Z", // well before SNAPSHOT_TIME — see the regression test's identical comment above.
    });
    return { fixtures, fixture };
  }

  it("catches a buggy odds repository that leaks a future observation past its own AsOf filter", async () => {
    const { fixtures, fixture } = await baseFixture();
    const matchResults = new InMemoryMatchResultsRepository();
    const matchEvents = new InMemoryMatchEventsRepository();
    const teamObservations = new InMemoryTeamObservationsRepository();

    const buggyOdds: OddsObservationsRepository = {
      async insert(input) {
        return { id: generateId(), ...input } as OddsObservation;
      },
      async listForFixture() {
        return [];
      },
      // Deliberately ignores `asOf` — simulates a future repository bug.
      async listForFixtureAsOf(fixtureId): Promise<readonly OddsObservation[]> {
        return [
          {
            id: generateId(),
            fixtureId,
            marketType: "match_result_1x2",
            selection: "home",
            odds: 2.0,
            bookmakerSource: "test",
            observedAt: "2026-01-10T21:00:00Z", // after SNAPSHOT_TIME
            providerPublishedAt: undefined,
            temporalReliability: "estimated",
            provider: "adversarial_test",
            providerObservationId: undefined,
            ingestionRunId: undefined,
          },
        ];
      },
    };

    const deps: LeakageGuardDependencies = { fixtures, matchResults, matchEvents, teamObservations, oddsObservations: buggyOdds };
    const result = await getDataAsOf(deps, fixture.id, SNAPSHOT_TIME);

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.code).toBe(LeakageType.FUTURE_ODDS_LEAKAGE);
  });

  it("catches a buggy team-observations repository that leaks a future observation", async () => {
    const { fixtures, fixture } = await baseFixture();
    const matchResults = new InMemoryMatchResultsRepository();
    const matchEvents = new InMemoryMatchEventsRepository();
    const oddsObservations = new InMemoryOddsObservationsRepository();

    const buggyTeamObservations: TeamObservationsRepository = {
      async insert(input) {
        return { id: generateId(), ...input } as TeamObservation;
      },
      async listForTeamAsOf(teamId): Promise<readonly TeamObservation[]> {
        return [
          {
            id: generateId(),
            teamId,
            fixtureId: fixture.id,
            competitionId: undefined,
            observationType: "form",
            metrics: {},
            observedAt: "2026-01-10T21:00:00Z", // after SNAPSHOT_TIME
            providerPublishedAt: undefined,
            sourceUpdatedAt: undefined,
            provider: "adversarial_test",
            providerObservationId: undefined,
            ingestionRunId: undefined,
          },
        ];
      },
    };

    const deps: LeakageGuardDependencies = { fixtures, matchResults, matchEvents, teamObservations: buggyTeamObservations, oddsObservations };
    const result = await getDataAsOf(deps, fixture.id, SNAPSHOT_TIME);

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.code).toBe(LeakageType.FUTURE_STANDING_LEAKAGE);
  });

  it("catches a buggy match-events repository that leaks a future event", async () => {
    const { fixtures, fixture } = await baseFixture();
    const matchResults = new InMemoryMatchResultsRepository();
    const teamObservations = new InMemoryTeamObservationsRepository();
    const oddsObservations = new InMemoryOddsObservationsRepository();

    const buggyMatchEvents = {
      async insert(input: unknown) {
        return { id: generateId(), ...(input as object) } as MatchEvent;
      },
      async listForFixture() {
        return [] as readonly MatchEvent[];
      },
      async listForFixtureAsOf(fixtureId: string): Promise<readonly MatchEvent[]> {
        return [
          {
            id: generateId(),
            fixtureId,
            eventType: "goal",
            providerEventType: "GOAL",
            teamId: undefined,
            minute: 55,
            observedAt: "2026-01-10T19:55:00Z", // after SNAPSHOT_TIME
            provider: "adversarial_test",
            providerEventId: undefined,
          },
        ];
      },
    };

    const deps: LeakageGuardDependencies = { fixtures, matchResults, matchEvents: buggyMatchEvents, teamObservations, oddsObservations };
    const result = await getDataAsOf(deps, fixture.id, SNAPSHOT_TIME);

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.code).toBe(LeakageType.FUTURE_EVENT_LEAKAGE);
  });
});

describe("LeakageGuard — query contract edge cases", () => {
  it("rejects an unknown fixture id", async () => {
    const fixtures = new InMemoryFixturesRepository();
    const matchResults = new InMemoryMatchResultsRepository();
    const matchEvents = new InMemoryMatchEventsRepository();
    const teamObservations = new InMemoryTeamObservationsRepository();
    const oddsObservations = new InMemoryOddsObservationsRepository();
    const deps: LeakageGuardDependencies = { fixtures, matchResults, matchEvents, teamObservations, oddsObservations };

    const result = await getDataAsOf(deps, generateId(), "2026-01-10T18:00:00Z");
    expect(isErr(result)).toBe(true);
  });

  it("rejects an invalid snapshotTime", async () => {
    const fixtures = new InMemoryFixturesRepository();
    const fixture = await fixtures.upsert({
      competitionId: generateId(),
      seasonId: undefined,
      homeTeamId: generateId(),
      awayTeamId: generateId(),
      scheduledKickoffAt: "2026-01-10T19:00:00Z",
      status: "scheduled",
      providerStatusRaw: "NS",
      provider: "edge_case_test",
      providerFixtureId: "EDGE-1",
    });
    const deps: LeakageGuardDependencies = {
      fixtures,
      matchResults: new InMemoryMatchResultsRepository(),
      matchEvents: new InMemoryMatchEventsRepository(),
      teamObservations: new InMemoryTeamObservationsRepository(),
      oddsObservations: new InMemoryOddsObservationsRepository(),
    };

    const result = await getDataAsOf(deps, fixture.id, "not-a-timestamp");
    expect(isErr(result)).toBe(true);
  });
});

describe("computePreMatchSnapshotTime", () => {
  it("subtracts the caller-supplied lead time from scheduled kickoff, never hard-coding one", async () => {
    const fixtures = new InMemoryFixturesRepository();
    const fixture = await fixtures.upsert({
      competitionId: generateId(),
      seasonId: undefined,
      homeTeamId: generateId(),
      awayTeamId: generateId(),
      scheduledKickoffAt: "2026-01-10T19:00:00Z",
      status: "scheduled",
      providerStatusRaw: "NS",
      provider: "snapshot_time_test",
      providerFixtureId: "SNAP-1",
    });

    expect(computePreMatchSnapshotTime(fixture, 60)).toBe("2026-01-10T18:00:00.000Z");
    expect(computePreMatchSnapshotTime(fixture, 15)).toBe("2026-01-10T18:45:00.000Z");
    expect(computePreMatchSnapshotTime(fixture, 0)).toBe("2026-01-10T19:00:00.000Z");
  });
});
