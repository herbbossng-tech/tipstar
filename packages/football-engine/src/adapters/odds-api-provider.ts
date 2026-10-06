import { err, ok, ValidationError, type Result } from "@sport-os/shared";
import { MarketType } from "@sport-os/market-engine";
import { TemporalReliability } from "../canonical.js";
import { requireNonEmptyString, requirePositiveNumber, requireValidIsoDate, type NormalizedOddsObservation } from "../normalize.js";
import type { ProviderConfig, ProviderFetchOutcome, RawRecord } from "../provider.js";

/**
 * The Odds API adapter (Section 13 — LOCKED canonical odds provider:
 * bookmaker odds, pre-match/historical snapshots, point-in-time
 * retrieval). Terminates at this file's own boundary exactly like
 * adapters/sportmonks-provider.ts.
 *
 * No `FootballOddsProvider` facet is implemented here, deliberately: that
 * interface's `fetchOdds(params: { fixtureProviderId })` shape assumes a
 * per-fixture lookup, but The Odds API's own API is naturally shaped
 * around a bulk per-sport-key fetch (every event for a sport in one
 * call) — guessing at an unverified per-event endpoint path would be
 * exactly the kind of invented provider behavior Section 13's MOST
 * IMPORTANT RULE forbids. `fetchOddsApiLiveOdds`/`fetchOddsApiHistoricalOdds`
 * below are standalone functions the worker job (Section 13 #188) calls
 * directly and feeds into ingestion.ts's `ingestOddsObservations`,
 * mirroring how adapters/sportmonks-provider.ts's reference-data
 * fetchers are also standalone rather than forced into a mismatched
 * Section 04 facet.
 *
 * One raw provider "event" (one fixture, many bookmakers, many markets,
 * many outcomes) is flattened into one flat RawRecord per
 * (event, bookmaker, market, outcome) tuple — the granularity
 * ingestion.ts's `ingestOddsObservations`/normalizer contract expects
 * (one RawRecord -> one NormalizedOddsObservation).
 *
 * KNOWN LIMITATIONS — see FOOTBALL_PROVIDER_INTEGRATION.md for the full
 * writeup:
 *  - Market mapping covers ONLY h2h/totals/btts (verified via live
 *    research against The Odds API's own documentation). `spreads`,
 *    `double_chance`, and `draw_no_bet` are real Odds API market keys
 *    this adapter does NOT map yet — any market key outside
 *    ODDS_API_MARKET_MAP is rejected/quarantined, never silently
 *    mis-mapped onto a similarly-named canonical market.
 *  - `providerObservationId` is SYNTHESIZED by concatenating
 *    provider-supplied fields (event id, bookmaker key, market key,
 *    selection, timestamp) — The Odds API does not issue its own
 *    per-observation id. This is assembling an id from real provider
 *    data, not fabricating a value the provider never gave.
 */

export const ODDS_API_PROVIDER_NAME = "the-odds-api";

const DEFAULT_BASE_URL = "https://api.the-odds-api.com/v4";

/**
 * Explicit, narrow market mapping (Section 13 — "map provider markets
 * into existing canonical MarketType enum via EXPLICIT mapping
 * tables/functions; never claim support for a market merely because the
 * provider exposes something similarly named"). See this file's top doc
 * comment for the markets deliberately excluded.
 */
export const ODDS_API_MARKET_MAP: Readonly<Record<string, MarketType>> = {
  h2h: MarketType.MATCH_RESULT_1X2,
  totals: MarketType.OVER_UNDER,
  btts: MarketType.BOTH_TEAMS_TO_SCORE,
};

/** The `markets=` query value this adapter requests — exactly the keys it knows how to map, never a wider list "just in case". */
export const ODDS_API_SUPPORTED_MARKET_KEYS = Object.keys(ODDS_API_MARKET_MAP).join(",");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// ============================================================
// HTTP client — thin, injectable (tests supply a mock fetchImpl; never a
// real network call in the default test suite).
// ============================================================

type RawHttpOutcome = { readonly status: "ok"; readonly body: unknown } | { readonly status: "rate_limited"; readonly retryAfterSeconds: number | undefined } | { readonly status: "unavailable"; readonly reason: string };

async function doOddsApiRequest(config: ProviderConfig, fetchImpl: typeof fetch, path: string, query: Record<string, string>): Promise<RawHttpOutcome> {
  if (!config.apiKey) {
    return { status: "unavailable", reason: "The Odds API key is not configured." };
  }
  const url = new URL(`${config.baseUrl ?? DEFAULT_BASE_URL}${path}`);
  url.searchParams.set("apiKey", config.apiKey);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), { method: "GET", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 429) {
    const retryAfterHeader = response.headers.get("retry-after");
    const parsed = retryAfterHeader ? Number(retryAfterHeader) : undefined;
    return { status: "rate_limited", retryAfterSeconds: parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined };
  }
  if (response.status >= 500) {
    // Transient — thrown so withBoundedRetries() retries a bounded number of times.
    throw new Error(`The Odds API request failed with HTTP ${response.status}.`);
  }
  if (!response.ok) {
    // Not transient (e.g. 401/422) — retrying cannot succeed.
    return { status: "unavailable", reason: `The Odds API request failed with HTTP ${response.status}.` };
  }

  try {
    return { status: "ok", body: await response.json() };
  } catch {
    return { status: "unavailable", reason: "The Odds API response was not valid JSON." };
  }
}

function flattenOddsApiEvents(events: readonly Record<string, unknown>[], snapshotTimestamp: string | undefined): RawRecord[] {
  const flat: RawRecord[] = [];
  for (const event of events) {
    const bookmakers = Array.isArray(event.bookmakers) ? event.bookmakers.filter(isRecord) : [];
    for (const bookmaker of bookmakers) {
      const markets = Array.isArray(bookmaker.markets) ? bookmaker.markets.filter(isRecord) : [];
      for (const market of markets) {
        const outcomes = Array.isArray(market.outcomes) ? market.outcomes.filter(isRecord) : [];
        for (const outcome of outcomes) {
          flat.push({
            event_id: event.id,
            commence_time: event.commence_time,
            home_team: event.home_team,
            away_team: event.away_team,
            bookmaker_key: bookmaker.key,
            market_key: market.key,
            market_last_update: market.last_update,
            bookmaker_last_update: bookmaker.last_update,
            outcome_name: outcome.name,
            outcome_price: outcome.price,
            outcome_point: outcome.point,
            // Only present for a historical fetch — see
            // fetchOddsApiHistoricalOdds's doc comment.
            snapshot_timestamp: snapshotTimestamp,
          });
        }
      }
    }
  }
  return flat;
}

/** Current/live odds for every event under `sportKey` — `observedAt` for each flattened observation falls back to the caller's own fetch time (there is no other candidate for "current"). */
export async function fetchOddsApiLiveOdds(config: ProviderConfig, sportKey: string, fetchImpl: typeof fetch = fetch): Promise<ProviderFetchOutcome<RawRecord>> {
  const outcome = await doOddsApiRequest(config, fetchImpl, `/sports/${encodeURIComponent(sportKey)}/odds`, { regions: "uk,eu,us", markets: ODDS_API_SUPPORTED_MARKET_KEYS, oddsFormat: "decimal" });
  if (outcome.status !== "ok") return outcome;
  if (!Array.isArray(outcome.body)) {
    return { status: "unavailable", reason: "Odds API live response was not an array." };
  }
  return { status: "ok", records: flattenOddsApiEvents(outcome.body.filter(isRecord), undefined), fetchedAt: new Date().toISOString() };
}

/**
 * Historical odds as of `requestedAsOf`. "The Odds API historical
 * endpoint returns the closest snapshot equal to or earlier than the
 * requested timestamp" (Section 13 — must be documented verbatim; see
 * FOOTBALL_PROVIDER_INTEGRATION.md). The response envelope's OWN
 * `timestamp` field — the actual snapshot time — is threaded through to
 * every flattened record as `snapshot_timestamp` and is what
 * `normalizeOddsApiOdds` uses as `observedAt`. `requestedAsOf` itself is
 * NEVER written into a normalized observation — relabeling the returned
 * (closest-earlier) snapshot as exactly equal to the requested time would
 * silently corrupt LeakageGuard's point-in-time guarantees.
 */
export async function fetchOddsApiHistoricalOdds(config: ProviderConfig, sportKey: string, requestedAsOf: string, fetchImpl: typeof fetch = fetch): Promise<ProviderFetchOutcome<RawRecord>> {
  const outcome = await doOddsApiRequest(config, fetchImpl, `/historical/sports/${encodeURIComponent(sportKey)}/odds`, {
    regions: "uk,eu,us",
    markets: ODDS_API_SUPPORTED_MARKET_KEYS,
    oddsFormat: "decimal",
    date: requestedAsOf,
  });
  if (outcome.status !== "ok") return outcome;
  const body = outcome.body;
  if (!isRecord(body) || !Array.isArray(body.data) || typeof body.timestamp !== "string") {
    return { status: "unavailable", reason: "Odds API historical response did not contain the expected {timestamp, data} envelope." };
  }
  return { status: "ok", records: flattenOddsApiEvents(body.data.filter(isRecord), body.timestamp), fetchedAt: new Date().toISOString() };
}

// ============================================================
// Normalizer
// ============================================================

function selectionForOutcome(marketKey: string, outcomeNameRaw: unknown, homeTeam: unknown, awayTeam: unknown, point: unknown): string | undefined {
  if (typeof outcomeNameRaw !== "string") return undefined;
  const outcomeName = outcomeNameRaw;
  if (marketKey === "h2h") {
    if (outcomeName === homeTeam) return "home";
    if (outcomeName === awayTeam) return "away";
    if (outcomeName.toLowerCase() === "draw") return "draw";
    return undefined;
  }
  if (marketKey === "totals") {
    if (typeof point !== "number" || !Number.isFinite(point)) return undefined;
    const side = outcomeName.toLowerCase();
    if (side !== "over" && side !== "under") return undefined;
    return `${side}_${point}`;
  }
  if (marketKey === "btts") {
    const side = outcomeName.toLowerCase();
    if (side !== "yes" && side !== "no") return undefined;
    return side;
  }
  return undefined;
}

/**
 * `fetchedAtFallback` is used as `observedAt` ONLY when the flat record
 * has no `snapshot_timestamp` (i.e. it came from a live, not historical,
 * fetch) — see fetchOddsApiLiveOdds/fetchOddsApiHistoricalOdds above.
 */
export function normalizeOddsApiOdds(raw: RawRecord, fetchedAtFallback: string): Result<NormalizedOddsObservation, ValidationError> {
  const eventId = requireNonEmptyString(raw.event_id, "event_id");
  if (!eventId.ok) return eventId;
  const marketKey = requireNonEmptyString(raw.market_key, "market_key");
  if (!marketKey.ok) return marketKey;

  const marketType = ODDS_API_MARKET_MAP[marketKey.value];
  if (!marketType) {
    return err(new ValidationError({ message: `Odds API market '${marketKey.value}' is not in the explicit mapping table — rejected, never guessed.`, code: "ODDS_API_UNSUPPORTED_MARKET", context: { marketKey: marketKey.value } }));
  }

  const selection = selectionForOutcome(marketKey.value, raw.outcome_name, raw.home_team, raw.away_team, raw.outcome_point);
  if (!selection) {
    return err(new ValidationError({ message: "Could not resolve a canonical selection for this outcome.", code: "ODDS_API_UNRESOLVED_SELECTION" }));
  }

  const price = requirePositiveNumber(raw.outcome_price, "outcome_price");
  if (!price.ok) return price;
  const bookmakerKey = requireNonEmptyString(raw.bookmaker_key, "bookmaker_key");
  if (!bookmakerKey.ok) return bookmakerKey;

  const observedAtRaw = typeof raw.snapshot_timestamp === "string" ? raw.snapshot_timestamp : fetchedAtFallback;
  const observedAt = requireValidIsoDate(observedAtRaw, "observedAt");
  if (!observedAt.ok) return observedAt;

  const providerPublishedAtRaw =
    typeof raw.market_last_update === "string" ? raw.market_last_update : typeof raw.bookmaker_last_update === "string" ? raw.bookmaker_last_update : typeof raw.snapshot_timestamp === "string" ? raw.snapshot_timestamp : undefined;
  let providerPublishedAt: string | undefined;
  if (providerPublishedAtRaw !== undefined) {
    const parsed = requireValidIsoDate(providerPublishedAtRaw, "providerPublishedAt");
    if (!parsed.ok) return parsed;
    providerPublishedAt = parsed.value;
  }

  return ok({
    provider: ODDS_API_PROVIDER_NAME,
    providerObservationId: `${eventId.value}:${bookmakerKey.value}:${marketKey.value}:${selection}:${providerPublishedAt ?? observedAt.value}`,
    providerFixtureId: eventId.value,
    marketType,
    selection,
    odds: price.value,
    bookmakerSource: bookmakerKey.value,
    observedAt: observedAt.value,
    providerPublishedAt,
    temporalReliability: providerPublishedAt !== undefined ? TemporalReliability.CONFIRMED : TemporalReliability.ESTIMATED,
  });
}
