import {
  InMemoryCompetitionsRepository,
  InMemoryFixtureExternalIdentitiesRepository,
  InMemoryFixturesRepository,
  InMemoryIngestionRunsRepository,
  InMemoryMatchEventsRepository,
  InMemoryMatchResultsRepository,
  InMemoryOddsObservationsRepository,
  InMemoryQuarantineRepository,
  InMemorySeasonsRepository,
  InMemoryTeamObservationsRepository,
  InMemoryTeamsRepository,
  type IngestionDependencies,
  type ProviderConfig,
} from "@sport-os/football-engine";
import { JobStatus, type OperationalJobRecord } from "@sport-os/platform";
import { describe, expect, it, vi } from "vitest";
import { FootballOddsIngestionJobHandler } from "./football-odds-ingestion-job.js";

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

function buildConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return { provider: "the-odds-api", enabled: true, baseUrl: undefined, apiKey: "test-key", timeoutMs: 5_000, maxRetries: 1, rateLimitPerMinute: undefined, pollIntervalSeconds: undefined, ...overrides };
}

function job(): OperationalJobRecord {
  return {
    jobId: "j1" as never,
    jobType: "FOOTBALL_ODDS_INGESTION" as never,
    status: JobStatus.RUNNING,
    payloadReference: {},
    scheduledAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    completedAt: undefined,
    attempts: 1,
    maxAttempts: 3,
    nextAttemptAt: undefined,
    lastError: undefined,
    lastFailureCategory: undefined,
    idempotencyKey: "k1",
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function seedFixture(deps: IngestionDependencies, homeTeamName: string, awayTeamName: string, scheduledKickoffAt: string, providerFixtureId: string) {
  const competition = await deps.competitions.upsert({ provider: "sportmonks", providerCompetitionId: "L1", name: "Test League", country: undefined, competitionType: undefined, active: true });
  const home = await deps.teams.upsert({ provider: "sportmonks", providerTeamId: `${providerFixtureId}-H`, name: homeTeamName, shortName: undefined, country: undefined });
  const away = await deps.teams.upsert({ provider: "sportmonks", providerTeamId: `${providerFixtureId}-A`, name: awayTeamName, shortName: undefined, country: undefined });
  return deps.fixtures.upsert({
    competitionId: competition.id,
    seasonId: undefined,
    homeTeamId: home.id,
    awayTeamId: away.id,
    scheduledKickoffAt,
    status: "scheduled",
    providerStatusRaw: "NS",
    provider: "sportmonks",
    providerFixtureId,
  });
}

const EVENT = { id: "ODDS-EVT-1", commence_time: "2026-02-01T18:00:00Z", home_team: "Arsenal", away_team: "Chelsea", bookmakers: [{ key: "pinnacle", last_update: "2026-02-01T17:55:00Z", markets: [{ key: "h2h", outcomes: [{ name: "Arsenal", price: 1.9 }] }] }] };

describe("FootballOddsIngestionJobHandler", () => {
  it("disabled provider safely no-ops without making any request", async () => {
    const fetchImpl = vi.fn();
    const handler = new FootballOddsIngestionJobHandler(buildDeps(), new InMemoryFixtureExternalIdentitiesRepository(), buildConfig({ enabled: false }), ["soccer_epl"], fetchImpl as unknown as typeof fetch);
    const result = await handler.handle(job());
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("no sport keys configured safely no-ops without making any request", async () => {
    const fetchImpl = vi.fn();
    const handler = new FootballOddsIngestionJobHandler(buildDeps(), new InMemoryFixtureExternalIdentitiesRepository(), buildConfig(), [], fetchImpl as unknown as typeof fetch);
    const result = await handler.handle(job());
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a confident single-candidate team-name match records a fixture_external_identities mapping and ingests the odds observation", async () => {
    const deps = buildDeps();
    const fixture = await seedFixture(deps, "Arsenal", "Chelsea", "2026-02-01T18:00:00Z", "SM-FIX-1");
    const identities = new InMemoryFixtureExternalIdentitiesRepository();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([EVENT]));

    const handler = new FootballOddsIngestionJobHandler(deps, identities, buildConfig(), ["soccer_epl"], fetchImpl as unknown as typeof fetch);
    const result = await handler.handle(job());
    expect(result).toEqual({ ok: true });

    const mapped = await identities.resolve("the-odds-api", "ODDS-EVT-1");
    expect(mapped).toBe(fixture.id);

    const odds = await deps.oddsObservations.listForFixture(fixture.id);
    expect(odds).toHaveLength(1);
    expect(odds[0]?.selection).toBe("home");
  });

  it("zero candidate fixtures quarantines the event and never ingests odds for it", async () => {
    const deps = buildDeps(); // no fixtures seeded at all
    const identities = new InMemoryFixtureExternalIdentitiesRepository();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([EVENT]));

    const handler = new FootballOddsIngestionJobHandler(deps, identities, buildConfig(), ["soccer_epl"], fetchImpl as unknown as typeof fetch);
    const result = await handler.handle(job());
    expect(result).toEqual({ ok: true }); // a quarantine is not a job failure

    expect(await identities.resolve("the-odds-api", "ODDS-EVT-1")).toBeUndefined();
    // Reconciliation quarantines with ingestionRunId: undefined (it runs before any IngestionRun exists for this odds batch) — listForRun(undefined) finds exactly those records.
    const quarantined = await deps.quarantine.listForRun(undefined as unknown as string);
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]?.reason).toContain("No candidate Sportmonks fixture matched team names");
    expect(quarantined[0]?.providerRecordId).toBe("ODDS-EVT-1");
  });

  it("multiple candidate fixtures (ambiguous match) quarantines the event rather than guessing which one", async () => {
    const deps = buildDeps();
    // Two distinct fixtures with the SAME team names within the kickoff window — genuinely ambiguous.
    await seedFixture(deps, "Arsenal", "Chelsea", "2026-02-01T18:05:00Z", "SM-FIX-1");
    await seedFixture(deps, "Arsenal", "Chelsea", "2026-02-01T18:10:00Z", "SM-FIX-2");
    const identities = new InMemoryFixtureExternalIdentitiesRepository();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([EVENT]));

    const handler = new FootballOddsIngestionJobHandler(deps, identities, buildConfig(), ["soccer_epl"], fetchImpl as unknown as typeof fetch);
    const result = await handler.handle(job());
    expect(result).toEqual({ ok: true });

    expect(await identities.resolve("the-odds-api", "ODDS-EVT-1")).toBeUndefined();
    const odds = [...(await deps.oddsObservations.listForFixture((await deps.fixtures.getByProviderIdentity("sportmonks", "SM-FIX-1"))!.id)), ...(await deps.oddsObservations.listForFixture((await deps.fixtures.getByProviderIdentity("sportmonks", "SM-FIX-2"))!.id))];
    expect(odds).toHaveLength(0);
    const quarantined = await deps.quarantine.listForRun(undefined as unknown as string);
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]?.reason).toContain("Ambiguous match: 2 candidate Sportmonks fixtures");
  });

  it("an already-confirmed mapping from a prior run is reused without re-running reconciliation, and still ingests new odds", async () => {
    const deps = buildDeps();
    const fixture = await seedFixture(deps, "Arsenal", "Chelsea", "2026-02-01T18:00:00Z", "SM-FIX-1");
    const identities = new InMemoryFixtureExternalIdentitiesRepository();
    await identities.recordMapping({ fixtureId: fixture.id, provider: "the-odds-api", providerFixtureId: "ODDS-EVT-1", matchMethod: "team_name_kickoff_time" });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([EVENT]));

    const handler = new FootballOddsIngestionJobHandler(deps, identities, buildConfig(), ["soccer_epl"], fetchImpl as unknown as typeof fetch);
    const result = await handler.handle(job());
    expect(result).toEqual({ ok: true });

    const odds = await deps.oddsObservations.listForFixture(fixture.id);
    expect(odds).toHaveLength(1);
  });

  it("an Odds API fetch failure (HTTP 401) makes the job report a retryable INTEGRATION_UNAVAILABLE failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 401));
    const handler = new FootballOddsIngestionJobHandler(buildDeps(), new InMemoryFixtureExternalIdentitiesRepository(), buildConfig(), ["soccer_epl"], fetchImpl as unknown as typeof fetch);
    const result = await handler.handle(job());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.category).toBe("INTEGRATION_UNAVAILABLE");
  });
});
