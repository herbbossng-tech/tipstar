import { describe, expect, it, vi } from "vitest";
import {
  buildSportmonksProvider,
  fetchSportmonksCompetitions,
  fetchSportmonksSeasons,
  normalizeSportmonksCompetition,
  normalizeSportmonksFixture,
  normalizeSportmonksMatchEvent,
  normalizeSportmonksMatchResult,
  normalizeSportmonksMatchStatus,
  normalizeSportmonksSeason,
  normalizeSportmonksTeam,
  SPORTMONKS_PROVIDER_NAME,
} from "./sportmonks-provider.js";
import type { ProviderConfig } from "../provider.js";

/**
 * Deterministic tests only — every "HTTP call" below is a mocked
 * `fetchImpl`, never a real network request (Section 13 spec: "test
 * suite must NOT depend on real external API calls by default").
 */

function buildConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return { provider: SPORTMONKS_PROVIDER_NAME, enabled: true, baseUrl: undefined, apiKey: "test-key", timeoutMs: 5_000, maxRetries: 2, rateLimitPerMinute: undefined, pollIntervalSeconds: undefined, ...overrides };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("normalizeSportmonksMatchStatus", () => {
  it("maps only the verified short names", () => {
    expect(normalizeSportmonksMatchStatus("NS")).toBe("scheduled");
    expect(normalizeSportmonksMatchStatus("1st")).toBe("live");
    expect(normalizeSportmonksMatchStatus("HT")).toBe("halftime");
    expect(normalizeSportmonksMatchStatus("BRK")).toBe("halftime");
    expect(normalizeSportmonksMatchStatus("FT")).toBe("finished");
  });

  it("never guesses an unverified or unrecognized short name — including 2nd half — it normalizes to unknown", () => {
    expect(normalizeSportmonksMatchStatus("2nd")).toBe("unknown");
    expect(normalizeSportmonksMatchStatus("AET")).toBe("unknown");
    expect(normalizeSportmonksMatchStatus("POSTP")).toBe("unknown");
    expect(normalizeSportmonksMatchStatus(undefined)).toBe("unknown");
  });
});

describe("normalizeSportmonksCompetition / Season / Team", () => {
  it("normalizes a well-formed league", () => {
    const result = normalizeSportmonksCompetition({ id: 501, name: "Premier League", type: "league" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ provider: SPORTMONKS_PROVIDER_NAME, providerCompetitionId: "501", name: "Premier League", country: undefined, competitionType: "league", active: true });
    }
  });

  it("rejects a league missing a name", () => {
    const result = normalizeSportmonksCompetition({ id: 501 });
    expect(result.ok).toBe(false);
  });

  it("normalizes a season and preserves the league_id it was attached under", () => {
    const result = normalizeSportmonksSeason({ id: 19735, league_id: 501, name: "2025/2026", starting_at: "2025-08-01", ending_at: "2026-05-31", is_current: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.providerSeasonId).toBe("19735");
      expect(result.value.providerCompetitionId).toBe("501");
      expect(result.value.status).toBe("current");
    }
  });

  it("rejects a season missing league_id — never silently orphaned", () => {
    const result = normalizeSportmonksSeason({ id: 19735, name: "2025/2026" });
    expect(result.ok).toBe(false);
  });

  it("normalizes a team", () => {
    const result = normalizeSportmonksTeam({ id: 19, name: "Arsenal", short_code: "ARS" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ provider: SPORTMONKS_PROVIDER_NAME, providerTeamId: "19", name: "Arsenal", shortName: "ARS", country: undefined });
    }
  });
});

describe("normalizeSportmonksFixture", () => {
  const baseFixture = {
    id: 18528480,
    league_id: 501,
    season_id: 19735,
    starting_at_timestamp: 1767898800, // 2026-01-08T19:00:00Z
    state: { short_name: "NS" },
    participants: [
      { id: 19, meta: { location: "home" } },
      { id: 20, meta: { location: "away" } },
    ],
  };

  it("normalizes a well-formed fixture using the unambiguous epoch timestamp", () => {
    const result = normalizeSportmonksFixture(baseFixture);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.providerFixtureId).toBe("18528480");
      expect(result.value.providerCompetitionId).toBe("501");
      expect(result.value.providerSeasonId).toBe("19735");
      expect(result.value.providerHomeTeamId).toBe("19");
      expect(result.value.providerAwayTeamId).toBe("20");
      expect(result.value.scheduledKickoffAt).toBe(new Date(1767898800 * 1000).toISOString());
      expect(result.value.status).toBe("scheduled");
      expect(result.value.providerStatusRaw).toBe("NS");
    }
  });

  it("falls back to the space-separated starting_at string (treated as UTC) when no timestamp is present", () => {
    const withoutTimestamp: Record<string, unknown> = { ...baseFixture };
    delete withoutTimestamp.starting_at_timestamp;
    const result = normalizeSportmonksFixture({ ...withoutTimestamp, starting_at: "2026-01-08 19:00:00" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.scheduledKickoffAt).toBe("2026-01-08T19:00:00.000Z");
    }
  });

  it("rejects a fixture with no home/away participant meta.location", () => {
    const result = normalizeSportmonksFixture({ ...baseFixture, participants: [{ id: 19 }, { id: 20 }] });
    expect(result.ok).toBe(false);
  });

  it("rejects a fixture missing both starting_at_timestamp and starting_at", () => {
    const withoutTimestamp: Record<string, unknown> = { ...baseFixture };
    delete withoutTimestamp.starting_at_timestamp;
    const result = normalizeSportmonksFixture(withoutTimestamp);
    expect(result.ok).toBe(false);
  });
});

describe("normalizeSportmonksMatchResult", () => {
  it("extracts the CURRENT score for both participants", () => {
    const raw = {
      id: 18528480,
      scores: [
        { description: "1ST_HALF", score: { goals: 1, participant: "home" } },
        { description: "CURRENT", score: { goals: 2, participant: "home" } },
        { description: "CURRENT", score: { goals: 1, participant: "away" } },
      ],
    };
    const result = normalizeSportmonksMatchResult(raw, "2026-01-08T21:00:00Z");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        providerFixtureId: "18528480",
        homeGoals: 2,
        awayGoals: 1,
        halftimeHomeGoals: undefined,
        halftimeAwayGoals: undefined,
        resultRecordedAt: "2026-01-08T21:00:00Z",
        source: SPORTMONKS_PROVIDER_NAME,
      });
    }
  });

  it("rejects a fixture with no CURRENT score for both sides rather than fabricating one", () => {
    const raw = { id: 18528480, scores: [{ description: "1ST_HALF", score: { goals: 1, participant: "home" } }] };
    const result = normalizeSportmonksMatchResult(raw, "2026-01-08T21:00:00Z");
    expect(result.ok).toBe(false);
  });
});

describe("normalizeSportmonksMatchEvent", () => {
  it("classifies a goal event by type.name keyword", () => {
    const result = normalizeSportmonksMatchEvent({ id: 1, fixture_id: 18528480, type: { name: "Goal" }, participant_id: 19, minute: 23 }, "2026-01-08T19:23:00Z");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.eventType).toBe("goal");
      expect(result.value.providerTeamId).toBe("19");
      expect(result.value.minute).toBe(23);
      expect(result.value.observedAt).toBe("2026-01-08T19:23:00Z");
    }
  });

  it("classifies own goal, missed penalty, and card events distinctly", () => {
    expect(normalizeSportmonksMatchEvent({ id: 2, fixture_id: 1, type: { name: "Own Goal" } }, "t").ok && "ok").toBeTruthy();
    const ownGoal = normalizeSportmonksMatchEvent({ id: 2, fixture_id: 1, type: { name: "Own Goal" } }, "t");
    if (ownGoal.ok) expect(ownGoal.value.eventType).toBe("own_goal");

    const missedPen = normalizeSportmonksMatchEvent({ id: 3, fixture_id: 1, type: { name: "Missed Penalty" } }, "t");
    if (missedPen.ok) expect(missedPen.value.eventType).toBe("missed_penalty");

    const yellow = normalizeSportmonksMatchEvent({ id: 4, fixture_id: 1, type: { name: "Yellow Card" } }, "t");
    if (yellow.ok) expect(yellow.value.eventType).toBe("yellow_card");

    const red = normalizeSportmonksMatchEvent({ id: 5, fixture_id: 1, type: { name: "Red Card" } }, "t");
    if (red.ok) expect(red.value.eventType).toBe("red_card");
  });

  it("rejects an event whose type.name is missing or unrecognized — never guessed", () => {
    expect(normalizeSportmonksMatchEvent({ id: 6, fixture_id: 1 }, "t").ok).toBe(false);
    expect(normalizeSportmonksMatchEvent({ id: 7, fixture_id: 1, type: { name: "Corner Awarded" } }, "t").ok).toBe(false);
  });
});

describe("HTTP client behavior (mocked fetchImpl)", () => {
  it("fetchSportmonksCompetitions returns ok with the fetched league records", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { id: 501, name: "Premier League" } }));
    const result = await fetchSportmonksCompetitions(buildConfig(), ["501"], fetchImpl as unknown as typeof fetch);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.records).toHaveLength(1);
      expect(result.records[0]?.id).toBe(501);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchImpl.mock.calls[0]?.[0]);
    expect(calledUrl).toContain("/leagues/501");
    expect(calledUrl).toContain("api_token=test-key");
  });

  it("an empty configured league list never fetches anything", async () => {
    const fetchImpl = vi.fn();
    const result = await fetchSportmonksCompetitions(buildConfig(), [], fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ status: "ok", records: [], fetchedAt: expect.any(String) });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetchSportmonksSeasons extracts currentSeason and attaches league_id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { id: 501, name: "Premier League", currentSeason: { id: 19735, name: "2025/2026" } } }));
    const result = await fetchSportmonksSeasons(buildConfig(), ["501"], fetchImpl as unknown as typeof fetch);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.records).toEqual([{ id: 19735, name: "2025/2026", league_id: 501 }]);
    }
  });

  it("missing SPORTMONKS_API_KEY returns unavailable, never throws or fabricates a successful response", async () => {
    const fetchImpl = vi.fn();
    const result = await fetchSportmonksCompetitions(buildConfig({ apiKey: undefined }), ["501"], fetchImpl as unknown as typeof fetch);
    expect(result.status).toBe("unavailable");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("an HTTP 429 maps to rate_limited with the retry-after header, not a thrown error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 429, { "retry-after": "30" }));
    const provider = buildSportmonksProvider(buildConfig(), fetchImpl as unknown as typeof fetch);
    const result = await provider.fixtures!.fetchFixtures({ since: "2026-01-08T00:00:00Z", until: "2026-01-08T00:00:00Z" });
    expect(result).toEqual({ status: "rate_limited", retryAfterSeconds: 30 });
  });

  it("an HTTP 500 throws (so provider.ts's withBoundedRetries can retry it), never returned as a structured outcome", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 500));
    const provider = buildSportmonksProvider(buildConfig(), fetchImpl as unknown as typeof fetch);
    await expect(provider.fixtures!.fetchFixtures({ since: "2026-01-08T00:00:00Z", until: "2026-01-08T00:00:00Z" })).rejects.toThrow();
  });

  it("an HTTP 401 maps to unavailable (never retried/thrown — retrying a bad credential cannot succeed)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 401));
    const provider = buildSportmonksProvider(buildConfig(), fetchImpl as unknown as typeof fetch);
    const result = await provider.fixtures!.fetchFixtures({ since: "2026-01-08T00:00:00Z", until: "2026-01-08T00:00:00Z" });
    expect(result.status).toBe("unavailable");
  });

  it("fetchFixtures paginates until has_more is false, aggregating every page's records", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 1 }], pagination: { has_more: true } }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 2 }], pagination: { has_more: false } }));
    const provider = buildSportmonksProvider(buildConfig(), fetchImpl as unknown as typeof fetch);
    const result = await provider.fixtures!.fetchFixtures({ since: "2026-01-08T00:00:00Z", until: "2026-01-08T00:00:00Z" });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.records).toEqual([{ id: 1 }, { id: 2 }]);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fetchTeams requires competitionProviderId and never guesses a global team list", async () => {
    const fetchImpl = vi.fn();
    const provider = buildSportmonksProvider(buildConfig(), fetchImpl as unknown as typeof fetch);
    const result = await provider.teams!.fetchTeams({});
    expect(result.status).toBe("unavailable");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetchEvents attaches fixture_id to every event and surfaces unavailable when events is absent", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { id: 18528480, events: [{ id: 1, type: { name: "Goal" } }] } }));
    const provider = buildSportmonksProvider(buildConfig(), fetchImpl as unknown as typeof fetch);
    const result = await provider.events!.fetchEvents({ fixtureProviderId: "18528480" });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.records[0]?.fixture_id).toBe("18528480");
    }

    const fetchImplNoEvents = vi.fn().mockResolvedValue(jsonResponse({ data: { id: 1 } }));
    const providerNoEvents = buildSportmonksProvider(buildConfig(), fetchImplNoEvents as unknown as typeof fetch);
    const resultNoEvents = await providerNoEvents.events!.fetchEvents({ fixtureProviderId: "1" });
    expect(resultNoEvents.status).toBe("unavailable");
  });

  it("buildSportmonksProvider never exposes an odds or players facet", () => {
    const provider = buildSportmonksProvider(buildConfig());
    expect(provider.odds).toBeUndefined();
    expect(provider.players).toBeUndefined();
  });
});
