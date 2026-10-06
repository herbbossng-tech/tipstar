import {
  InMemoryCompetitionsRepository,
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
import { FootballFixtureIngestionJobHandler } from "./football-fixture-ingestion-job.js";

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
  return { provider: "sportmonks", enabled: true, baseUrl: undefined, apiKey: "test-key", timeoutMs: 5_000, maxRetries: 1, rateLimitPerMinute: undefined, pollIntervalSeconds: undefined, ...overrides };
}

function job(): OperationalJobRecord {
  return {
    jobId: "j1" as never,
    jobType: "FOOTBALL_FIXTURE_INGESTION" as never,
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

async function seedReferenceData(deps: IngestionDependencies) {
  const competition = await deps.competitions.upsert({ provider: "sportmonks", providerCompetitionId: "501", name: "Premier League", country: undefined, competitionType: undefined, active: true });
  const home = await deps.teams.upsert({ provider: "sportmonks", providerTeamId: "19", name: "Arsenal", shortName: undefined, country: undefined });
  const away = await deps.teams.upsert({ provider: "sportmonks", providerTeamId: "20", name: "Chelsea", shortName: undefined, country: undefined });
  return { competition, home, away };
}

const FIXTURE_RAW = {
  id: 18528480,
  league_id: 501,
  starting_at_timestamp: Math.floor(new Date("2026-02-01T18:00:00Z").getTime() / 1000),
  state: { short_name: "FT" },
  participants: [
    { id: 19, meta: { location: "home" } },
    { id: 20, meta: { location: "away" } },
  ],
  scores: [
    { description: "CURRENT", score: { goals: 2, participant: "home" } },
    { description: "CURRENT", score: { goals: 1, participant: "away" } },
  ],
  events: [{ id: 1, type: { name: "Goal" }, participant_id: 19, minute: 23 }],
};

describe("FootballFixtureIngestionJobHandler", () => {
  it("disabled provider safely no-ops without making any request", async () => {
    const fetchImpl = vi.fn();
    const handler = new FootballFixtureIngestionJobHandler(buildDeps(), buildConfig({ enabled: false }), ["501"], fetchImpl as unknown as typeof fetch);
    const result = await handler.handle(job());
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ingests a fixture, its final result, and its events from ONE fetched Sportmonks payload — never three separate fetches", async () => {
    const deps = buildDeps();
    await seedReferenceData(deps);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [FIXTURE_RAW] }));

    const handler = new FootballFixtureIngestionJobHandler(deps, buildConfig(), ["501"], fetchImpl as unknown as typeof fetch);
    const result = await handler.handle(job());
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const fixture = await deps.fixtures.getByProviderIdentity("sportmonks", "18528480");
    expect(fixture).toBeDefined();
    expect(fixture?.status).toBe("finished");

    const matchResult = await deps.matchResults.getLatest(fixture!.id);
    expect(matchResult?.homeGoals).toBe(2);
    expect(matchResult?.awayGoals).toBe(1);

    const events = await deps.matchEvents.listForFixture(fixture!.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("goal");
  });

  it("a Sportmonks fetch failure (HTTP 401) makes the job report a retryable INTEGRATION_UNAVAILABLE failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 401));
    const handler = new FootballFixtureIngestionJobHandler(buildDeps(), buildConfig(), ["501"], fetchImpl as unknown as typeof fetch);
    const result = await handler.handle(job());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.category).toBe("INTEGRATION_UNAVAILABLE");
  });

  it("an empty fixtures response (no fixtures scheduled today) is a safe success, never an error — 'provider returned nothing' is not a failure", async () => {
    const deps = buildDeps();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const handler = new FootballFixtureIngestionJobHandler(deps, buildConfig(), ["501"], fetchImpl as unknown as typeof fetch);
    const result = await handler.handle(job());
    expect(result).toEqual({ ok: true });
  });
});
