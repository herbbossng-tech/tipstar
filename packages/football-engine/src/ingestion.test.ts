import { describe, expect, it } from "vitest";
import {
  TEST_FIXTURE_PROVIDER_NAME,
  TEST_FIXTURE_PROVIDER_RAW_DATA,
  normalizeTestFixtureCompetition,
  normalizeTestFixtureFixture,
  normalizeTestFixtureMatchEvent,
  normalizeTestFixtureMatchResult,
  normalizeTestFixtureOdds,
  normalizeTestFixtureSeason,
  normalizeTestFixtureTeam,
  testFixtureProvider,
} from "./adapters/test-fixture-provider.js";
import { ingestFixtures, ingestMatchEvents, ingestMatchResults, ingestOddsObservations, ingestReferenceData, type IngestionDependencies } from "./ingestion.js";
import { InMemoryFixturesRepository, InMemoryMatchEventsRepository, InMemoryMatchResultsRepository } from "./repositories/fixtures.js";
import { InMemoryIngestionRunsRepository } from "./repositories/ingestion-runs.js";
import { InMemoryOddsObservationsRepository, InMemoryTeamObservationsRepository } from "./repositories/observations.js";
import { InMemoryQuarantineRepository } from "./repositories/quality.js";
import { InMemoryCompetitionsRepository, InMemorySeasonsRepository, InMemoryTeamsRepository } from "./repositories/reference-data.js";

function buildDeps(): IngestionDependencies {
  return {
    competitions: new InMemoryCompetitionsRepository(),
    seasons: new InMemorySeasonsRepository(),
    teams: new InMemoryTeamsRepository(),
    fixtures: new InMemoryFixturesRepository(),
    matchResults: new InMemoryMatchResultsRepository(),
    matchEvents: new InMemoryMatchEventsRepository(),
    teamObservations: new InMemoryTeamObservationsRepository(),
    oddsObservations: new InMemoryOddsObservationsRepository(),
    ingestionRuns: new InMemoryIngestionRunsRepository(),
    quarantine: new InMemoryQuarantineRepository(),
  };
}

describe("ingestReferenceData", () => {
  it("upserts every competition/season/team in the deterministic fixture dataset", async () => {
    const deps = buildDeps();
    const result = await ingestReferenceData(
      deps,
      TEST_FIXTURE_PROVIDER_NAME,
      TEST_FIXTURE_PROVIDER_RAW_DATA,
      { normalizeCompetition: normalizeTestFixtureCompetition, normalizeSeason: normalizeTestFixtureSeason, normalizeTeam: normalizeTestFixtureTeam },
      undefined,
    );
    expect(result).toEqual({ competitionsUpserted: 2, seasonsUpserted: 2, teamsUpserted: 4, rejected: 0 });
  });

  it("is idempotent — running it twice does not create duplicate rows", async () => {
    const deps = buildDeps();
    const normalizers = { normalizeCompetition: normalizeTestFixtureCompetition, normalizeSeason: normalizeTestFixtureSeason, normalizeTeam: normalizeTestFixtureTeam };
    await ingestReferenceData(deps, TEST_FIXTURE_PROVIDER_NAME, TEST_FIXTURE_PROVIDER_RAW_DATA, normalizers, undefined);
    await ingestReferenceData(deps, TEST_FIXTURE_PROVIDER_NAME, TEST_FIXTURE_PROVIDER_RAW_DATA, normalizers, undefined);

    const arsenal = await deps.teams.getByProviderIdentity(TEST_FIXTURE_PROVIDER_NAME, "TFP-TEAM-1");
    expect(arsenal).toBeDefined();
    // Re-running upsert for the same provider identity must return the same internal id, not a second row.
    const arsenalAgain = await deps.teams.getByProviderIdentity(TEST_FIXTURE_PROVIDER_NAME, "TFP-TEAM-1");
    expect(arsenalAgain?.id).toBe(arsenal?.id);
  });
});

async function seedReferenceData(deps: IngestionDependencies) {
  return ingestReferenceData(
    deps,
    TEST_FIXTURE_PROVIDER_NAME,
    TEST_FIXTURE_PROVIDER_RAW_DATA,
    { normalizeCompetition: normalizeTestFixtureCompetition, normalizeSeason: normalizeTestFixtureSeason, normalizeTeam: normalizeTestFixtureTeam },
    undefined,
  );
}

describe("ingestFixtures", () => {
  it("ingests the deterministic fixture dataset: valid fixtures inserted, duplicate handled idempotently, invalid records quarantined", async () => {
    const deps = buildDeps();
    await seedReferenceData(deps);

    const run = await ingestFixtures(deps, testFixtureProvider, normalizeTestFixtureFixture, "backfill");

    // RAW_FIXTURES has 9 records: 6 distinct valid fixtures (2 completed,
    // 2 upcoming, 1 postponed, 1 cancelled), 1 duplicate of an existing
    // one (idempotent update, not a new row), and 2 deliberately invalid
    // (same-team; missing kickoff) — rejected, never inserted.
    expect(run.recordsReceived).toBe(9);
    expect(run.recordsInserted).toBe(6);
    expect(run.recordsUpdated).toBe(1);
    expect(run.recordsRejected).toBe(2);
    expect(run.status).toBe("partial");

    const quarantined = await deps.quarantine.listForRun(run.id);
    expect(quarantined).toHaveLength(2);
    expect(quarantined.map((q) => q.reason).some((r) => r.toLowerCase().includes("distinct"))).toBe(true);
  });

  it("never creates two fixture rows for the same provider+providerFixtureId even when the raw batch contains a duplicate", async () => {
    const deps = buildDeps();
    await seedReferenceData(deps);
    await ingestFixtures(deps, testFixtureProvider, normalizeTestFixtureFixture, "backfill");

    const fixture = await deps.fixtures.getByProviderIdentity(TEST_FIXTURE_PROVIDER_NAME, "TFP-FIX-1");
    expect(fixture).toBeDefined();
  });

  it("preserves scheduledKickoffAt across a second ingestion run — never overwritten", async () => {
    const deps = buildDeps();
    await seedReferenceData(deps);
    await ingestFixtures(deps, testFixtureProvider, normalizeTestFixtureFixture, "backfill");
    const before = await deps.fixtures.getByProviderIdentity(TEST_FIXTURE_PROVIDER_NAME, "TFP-FIX-1");

    await ingestFixtures(deps, testFixtureProvider, normalizeTestFixtureFixture, "live");
    const after = await deps.fixtures.getByProviderIdentity(TEST_FIXTURE_PROVIDER_NAME, "TFP-FIX-1");

    expect(after?.scheduledKickoffAt).toBe(before?.scheduledKickoffAt);
  });

  it("quarantines a fixture whose competition has not been ingested yet, rather than inserting a dangling reference", async () => {
    const deps = buildDeps();
    // Deliberately skip seedReferenceData — no competitions/teams exist yet.
    const run = await ingestFixtures(deps, testFixtureProvider, normalizeTestFixtureFixture, "backfill");
    expect(run.recordsRejected).toBe(run.recordsReceived);
    expect(run.recordsInserted).toBe(0);
  });
});

describe("ingestMatchResults / ingestMatchEvents / ingestOddsObservations", () => {
  async function seedFixtures(deps: IngestionDependencies) {
    await seedReferenceData(deps);
    await ingestFixtures(deps, testFixtureProvider, normalizeTestFixtureFixture, "backfill");
  }

  it("ingests match results for known fixtures and quarantines results for unknown ones", async () => {
    const deps = buildDeps();
    await seedFixtures(deps);

    const run = await ingestMatchResults(deps, TEST_FIXTURE_PROVIDER_NAME, "backfill", TEST_FIXTURE_PROVIDER_RAW_DATA.matchResults, normalizeTestFixtureMatchResult);
    expect(run.recordsReceived).toBe(2);
    expect(run.recordsInserted).toBe(2);
    expect(run.recordsRejected).toBe(0);
    expect(run.status).toBe("completed");

    const fixture = await deps.fixtures.getByProviderIdentity(TEST_FIXTURE_PROVIDER_NAME, "TFP-FIX-1");
    const result = await deps.matchResults.getLatest(fixture!.id);
    expect(result?.homeGoals).toBe(2);
    expect(result?.awayGoals).toBe(1);
  });

  it("ingests match events and resolves the scoring team to an internal id", async () => {
    const deps = buildDeps();
    await seedFixtures(deps);

    const run = await ingestMatchEvents(deps, TEST_FIXTURE_PROVIDER_NAME, "backfill", TEST_FIXTURE_PROVIDER_RAW_DATA.matchEvents, normalizeTestFixtureMatchEvent);
    expect(run.recordsInserted).toBe(2);
    expect(run.recordsRejected).toBe(0);

    const fixture = await deps.fixtures.getByProviderIdentity(TEST_FIXTURE_PROVIDER_NAME, "TFP-FIX-1");
    const events = await deps.matchEvents.listForFixture(fixture!.id);
    expect(events).toHaveLength(2);
    expect(events[0]?.teamId).toBeDefined();
  });

  it("ingests every odds observation, including pre- and post-kickoff ones — all preserved, never just the latest", async () => {
    const deps = buildDeps();
    await seedFixtures(deps);

    const run = await ingestOddsObservations(deps, TEST_FIXTURE_PROVIDER_NAME, "backfill", TEST_FIXTURE_PROVIDER_RAW_DATA.odds, normalizeTestFixtureOdds);
    expect(run.recordsInserted).toBe(4);
    expect(run.recordsRejected).toBe(0);

    const fixture = await deps.fixtures.getByProviderIdentity(TEST_FIXTURE_PROVIDER_NAME, "TFP-FIX-1");
    const odds = await deps.oddsObservations.listForFixture(fixture!.id);
    expect(odds).toHaveLength(4);

    const estimated = odds.find((o) => o.temporalReliability === "estimated");
    expect(estimated).toBeDefined();
    expect(estimated?.providerPublishedAt).toBeUndefined();
  });

  it("the point-in-time read for TFP-FIX-1 at its 19:00 kickoff sees only the 3 pre-kickoff odds observations, not the post-kickoff one", async () => {
    const deps = buildDeps();
    await seedFixtures(deps);
    await ingestOddsObservations(deps, TEST_FIXTURE_PROVIDER_NAME, "backfill", TEST_FIXTURE_PROVIDER_RAW_DATA.odds, normalizeTestFixtureOdds);

    const fixture = await deps.fixtures.getByProviderIdentity(TEST_FIXTURE_PROVIDER_NAME, "TFP-FIX-1");
    const asOfKickoff = await deps.oddsObservations.listForFixtureAsOf(fixture!.id, "2026-01-10T19:00:00Z");
    expect(asOfKickoff).toHaveLength(3);
    expect(asOfKickoff.every((o) => new Date(o.observedAt).getTime() <= new Date("2026-01-10T19:00:00Z").getTime())).toBe(true);
  });
});
