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
import { FootballReferenceIngestionJobHandler } from "./football-reference-ingestion-job.js";

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
    jobType: "FOOTBALL_REFERENCE_INGESTION" as never,
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

describe("FootballReferenceIngestionJobHandler", () => {
  it("disabled provider safely no-ops without making any request", async () => {
    const fetchImpl = vi.fn();
    const handler = new FootballReferenceIngestionJobHandler(buildDeps(), buildConfig({ enabled: false }), ["501"], fetchImpl as unknown as typeof fetch);
    const result = await handler.handle(job());
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("no competitions configured safely no-ops without making any request", async () => {
    const fetchImpl = vi.fn();
    const handler = new FootballReferenceIngestionJobHandler(buildDeps(), buildConfig(), [], fetchImpl as unknown as typeof fetch);
    const result = await handler.handle(job());
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ingests a competition/season/team from Sportmonks end to end", async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (url.includes("include=currentSeason.teams")) {
        return Promise.resolve(jsonResponse({ data: { id: 501, name: "Premier League", currentSeason: { id: 19735, name: "2025/2026", teams: [{ id: 19, name: "Arsenal" }] } } }));
      }
      return Promise.resolve(jsonResponse({ data: { id: 501, name: "Premier League", currentSeason: { id: 19735, name: "2025/2026" } } }));
    });
    const deps = buildDeps();
    const handler = new FootballReferenceIngestionJobHandler(deps, buildConfig(), ["501"], fetchImpl as unknown as typeof fetch);

    const result = await handler.handle(job());
    expect(result).toEqual({ ok: true });

    const competition = await deps.competitions.getByProviderIdentity("sportmonks", "501");
    expect(competition?.name).toBe("Premier League");
    const team = await deps.teams.getByProviderIdentity("sportmonks", "19");
    expect(team?.name).toBe("Arsenal");
  });

  it("a Sportmonks fetch failure (HTTP 401) makes the job report a retryable INTEGRATION_UNAVAILABLE failure, never a silent success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 401));
    const handler = new FootballReferenceIngestionJobHandler(buildDeps(), buildConfig(), ["501"], fetchImpl as unknown as typeof fetch);
    const result = await handler.handle(job());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.category).toBe("INTEGRATION_UNAVAILABLE");
  });
});
