import { describe, expect, it, vi } from "vitest";
import { MarketType } from "@sport-os/market-engine";
import { fetchOddsApiHistoricalOdds, fetchOddsApiLiveOdds, normalizeOddsApiOdds, ODDS_API_PROVIDER_NAME } from "./odds-api-provider.js";
import type { ProviderConfig } from "../provider.js";

/** Deterministic tests only — every "HTTP call" below is a mocked fetchImpl, never a real network request. */

function buildConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return { provider: ODDS_API_PROVIDER_NAME, enabled: true, baseUrl: undefined, apiKey: "test-key", timeoutMs: 5_000, maxRetries: 2, rateLimitPerMinute: undefined, pollIntervalSeconds: undefined, ...overrides };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const SAMPLE_EVENT = {
  id: "abc123def456",
  commence_time: "2026-01-10T19:00:00Z",
  home_team: "Arsenal",
  away_team: "Chelsea",
  bookmakers: [
    {
      key: "pinnacle",
      last_update: "2026-01-10T18:55:00Z",
      markets: [
        {
          key: "h2h",
          last_update: "2026-01-10T18:55:00Z",
          outcomes: [
            { name: "Arsenal", price: 1.9 },
            { name: "Chelsea", price: 4.2 },
            { name: "Draw", price: 3.4 },
          ],
        },
        {
          key: "totals",
          last_update: "2026-01-10T18:55:00Z",
          outcomes: [
            { name: "Over", price: 1.85, point: 2.5 },
            { name: "Under", price: 1.95, point: 2.5 },
          ],
        },
        {
          key: "spreads",
          last_update: "2026-01-10T18:55:00Z",
          outcomes: [{ name: "Arsenal", price: 1.9, point: -1.5 }],
        },
      ],
    },
  ],
};

describe("normalizeOddsApiOdds", () => {
  it("normalizes an h2h home outcome", () => {
    const raw = { event_id: "abc123def456", market_key: "h2h", outcome_name: "Arsenal", home_team: "Arsenal", away_team: "Chelsea", outcome_price: 1.9, bookmaker_key: "pinnacle", bookmaker_last_update: "2026-01-10T18:55:00Z" };
    const result = normalizeOddsApiOdds(raw, "2026-01-10T19:00:00Z");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.marketType).toBe(MarketType.MATCH_RESULT_1X2);
      expect(result.value.selection).toBe("home");
      expect(result.value.odds).toBe(1.9);
      expect(result.value.bookmakerSource).toBe("pinnacle");
      expect(result.value.temporalReliability).toBe("confirmed");
      // No snapshot_timestamp (a live, not historical, record) — observedAt is OUR fetch time; providerPublishedAt is the bookmaker's own last_update.
      expect(result.value.observedAt).toBe("2026-01-10T19:00:00.000Z");
      expect(result.value.providerPublishedAt).toBe("2026-01-10T18:55:00.000Z");
    }
  });

  it("normalizes a draw outcome and an away outcome", () => {
    const draw = normalizeOddsApiOdds({ event_id: "e1", market_key: "h2h", outcome_name: "Draw", home_team: "Arsenal", away_team: "Chelsea", outcome_price: 3.4, bookmaker_key: "pinnacle" }, "2026-01-10T19:00:00Z");
    expect(draw.ok).toBe(true);
    expect(draw.ok && draw.value.selection).toBe("draw");
    const away = normalizeOddsApiOdds({ event_id: "e1", market_key: "h2h", outcome_name: "Chelsea", home_team: "Arsenal", away_team: "Chelsea", outcome_price: 4.2, bookmaker_key: "pinnacle" }, "2026-01-10T19:00:00Z");
    expect(away.ok).toBe(true);
    expect(away.ok && away.value.selection).toBe("away");
  });

  it("normalizes a totals outcome with its line embedded in the selection", () => {
    const over = normalizeOddsApiOdds({ event_id: "e1", market_key: "totals", outcome_name: "Over", outcome_point: 2.5, outcome_price: 1.85, bookmaker_key: "pinnacle" }, "2026-01-10T19:00:00Z");
    expect(over.ok).toBe(true);
    expect(over.ok && over.value.selection).toBe("over_2.5");
  });

  it("normalizes a btts outcome", () => {
    const yes = normalizeOddsApiOdds({ event_id: "e1", market_key: "btts", outcome_name: "Yes", outcome_price: 1.7, bookmaker_key: "pinnacle" }, "2026-01-10T19:00:00Z");
    expect(yes.ok).toBe(true);
    expect(yes.ok && yes.value.selection).toBe("yes");
  });

  it("rejects a market key outside the explicit mapping table (e.g. spreads) rather than guessing", () => {
    const result = normalizeOddsApiOdds({ event_id: "e1", market_key: "spreads", outcome_name: "Arsenal", outcome_point: -1.5, outcome_price: 1.9, bookmaker_key: "pinnacle" }, "2026-01-10T19:00:00Z");
    expect(result.ok).toBe(false);
  });

  it("falls back to fetchedAtFallback as observedAt only when there is no snapshot_timestamp (a live fetch)", () => {
    const result = normalizeOddsApiOdds({ event_id: "e1", market_key: "btts", outcome_name: "Yes", outcome_price: 1.7, bookmaker_key: "pinnacle" }, "2026-01-10T19:30:00Z");
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.observedAt).toBe("2026-01-10T19:30:00.000Z");
  });

  it("uses the historical snapshot_timestamp as observedAt, never the live fetch fallback", () => {
    const result = normalizeOddsApiOdds({ event_id: "e1", market_key: "btts", outcome_name: "Yes", outcome_price: 1.7, bookmaker_key: "pinnacle", snapshot_timestamp: "2026-01-10T17:00:00Z" }, "2026-01-10T19:30:00Z");
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.observedAt).toBe("2026-01-10T17:00:00.000Z");
  });

  it("marks temporalReliability as estimated when no provider-published timestamp is available", () => {
    const result = normalizeOddsApiOdds({ event_id: "e1", market_key: "btts", outcome_name: "Yes", outcome_price: 1.7, bookmaker_key: "pinnacle" }, "2026-01-10T19:30:00Z");
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.temporalReliability).toBe("estimated");
  });
});

describe("fetchOddsApiLiveOdds (mocked fetchImpl)", () => {
  it("flattens bookmakers/markets/outcomes into one flat record each, filtering unsupported markets at normalize time (not fetch time)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([SAMPLE_EVENT]));
    const result = await fetchOddsApiLiveOdds(buildConfig(), "soccer_epl", fetchImpl as unknown as typeof fetch);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      // 3 h2h + 2 totals + 1 spreads outcomes = 6 flat records (spreads is still fetched/flattened; it is normalizeOddsApiOdds's job to reject it).
      expect(result.records).toHaveLength(6);
      expect(result.records.every((r) => r.snapshot_timestamp === undefined)).toBe(true);
    }
    const calledUrl = String(fetchImpl.mock.calls[0]?.[0]);
    expect(calledUrl).toContain("/sports/soccer_epl/odds");
    expect(calledUrl).toContain("apiKey=test-key");
    expect(calledUrl).toContain("markets=h2h%2Ctotals%2Cbtts");
  });

  it("missing API key returns unavailable without making a request", async () => {
    const fetchImpl = vi.fn();
    const result = await fetchOddsApiLiveOdds(buildConfig({ apiKey: undefined }), "soccer_epl", fetchImpl as unknown as typeof fetch);
    expect(result.status).toBe("unavailable");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("an HTTP 429 maps to rate_limited, never thrown", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 429, { "retry-after": "15" }));
    const result = await fetchOddsApiLiveOdds(buildConfig(), "soccer_epl", fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ status: "rate_limited", retryAfterSeconds: 15 });
  });

  it("an HTTP 500 throws, so provider.ts's withBoundedRetries can retry it", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 500));
    await expect(fetchOddsApiLiveOdds(buildConfig(), "soccer_epl", fetchImpl as unknown as typeof fetch)).rejects.toThrow();
  });
});

describe("fetchOddsApiHistoricalOdds (mocked fetchImpl)", () => {
  it("preserves the envelope's own timestamp as snapshot_timestamp, never the requested date", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ timestamp: "2026-01-10T17:58:00Z", previous_timestamp: "2026-01-10T17:28:00Z", next_timestamp: "2026-01-10T18:28:00Z", data: [SAMPLE_EVENT] }));
    const result = await fetchOddsApiHistoricalOdds(buildConfig(), "soccer_epl", "2026-01-10T18:00:00Z", fetchImpl as unknown as typeof fetch);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.records.every((r) => r.snapshot_timestamp === "2026-01-10T17:58:00Z")).toBe(true);
      // The requested date (18:00) must never appear as the snapshot timestamp — the actual, earlier snapshot (17:58) always wins.
      expect(result.records.some((r) => r.snapshot_timestamp === "2026-01-10T18:00:00Z")).toBe(false);
    }
    const calledUrl = String(fetchImpl.mock.calls[0]?.[0]);
    expect(calledUrl).toContain("date=2026-01-10T18%3A00%3A00Z");
  });

  it("a response missing the envelope's own `timestamp` field is unavailable, never falls back to the requested date", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [SAMPLE_EVENT] }));
    const result = await fetchOddsApiHistoricalOdds(buildConfig(), "soccer_epl", "2026-01-10T18:00:00Z", fetchImpl as unknown as typeof fetch);
    expect(result.status).toBe("unavailable");
  });
});
