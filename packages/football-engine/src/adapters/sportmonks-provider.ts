import { err, ok, ValidationError, type Result } from "@sport-os/shared";
import { MatchStatus, type MatchEventType } from "../canonical.js";
import {
  requireNonEmptyString,
  requireValidIsoDate,
  type NormalizedCompetition,
  type NormalizedFixture,
  type NormalizedMatchEvent,
  type NormalizedMatchResult,
  type NormalizedSeason,
  type NormalizedTeam,
} from "../normalize.js";
import type { FootballDataProvider, FootballEventProvider, FootballFixtureProvider, FootballTeamProvider, ProviderConfig, ProviderFetchOutcome, RawRecord } from "../provider.js";

/**
 * Sportmonks adapter (Section 13 — LOCKED canonical football-data
 * provider: competitions/seasons/teams/fixtures/fixture-status/results/
 * events). Terminates at this file's own boundary exactly like
 * adapters/test-fixture-provider.ts — the rest of the system only ever
 * sees RawRecord (pre-normalization) or canonical (post-normalization)
 * shapes, never a Sportmonks-specific type.
 *
 * KNOWN LIMITATIONS (MOST IMPORTANT RULE compliance — "do not invent
 * provider API behavior... stop at the adapter boundary and report the
 * limitation rather than fabricating"): docs.sportmonks.com was
 * unreachable from this development environment (network egress
 * blocked), so the shapes below were corroborated only via third-party
 * search results and general training-time familiarity with Sportmonks
 * API v3, NOT independently re-verified against live/current
 * documentation. Every normalizer below is written defensively — an
 * unrecognized or unverified shape is REJECTED (quarantined by
 * ingestion.ts), never guessed into a value. Specific, narrower gaps:
 *  - Match status: only `state.short_name` values NS/1st/HT/BRK/FT are
 *    mapped with any confidence. Extra-time/penalties, postponed,
 *    cancelled, abandoned, suspended, interrupted, delayed, awarded, and
 *    walkover all normalize to MatchStatus.UNKNOWN until independently
 *    re-verified — including, notably, 2nd-half-live fixtures, since
 *    only the 1st-half short_name could be corroborated.
 *  - Match results: derived from the SAME fixture payload's `scores`
 *    include (Sportmonks has no separate "results" endpoint), reading
 *    only entries with `description === "CURRENT"`. Half-time goal
 *    counts are never populated (no verified description value for
 *    them) — always undefined, never guessed.
 *  - `resultRecordedAt`: Sportmonks does not supply a result-specific
 *    timestamp distinct from the fixture itself, so this is OUR OWN
 *    ingestion-time observation — the same convention already
 *    established for fixture status transitions without a provider
 *    timestamp (see repositories/fixtures.ts's NewFixtureInput.observedAt
 *    doc comment). Never presented as a Sportmonks-supplied timestamp.
 *  - Match events: classified from `type.name` by case-insensitive
 *    keyword match (goal/own goal/penalty/yellow/red/substitution/var),
 *    not from a verified numeric `type_id` table — an unrecognized or
 *    missing type name is rejected, never guessed.
 *  - `active` (NormalizedCompetition): Sportmonks' league resource has no
 *    independently verified "is this league active" boolean; defaults to
 *    `true` rather than fabricating a `false` the provider never sent.
 *  - Reference data (competitions/seasons/teams) is scoped to each
 *    league's CURRENT season only — historical seasons are not ingested
 *    by this adapter.
 * See docs/architecture/FOOTBALL_PROVIDER_INTEGRATION.md for the full
 * writeup and production-activation checklist.
 */

export const SPORTMONKS_PROVIDER_NAME = "sportmonks";

const DEFAULT_BASE_URL = "https://api.sportmonks.com/v3/football";
const MAX_PAGES = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Sportmonks ids are numeric; canonical provider ids are strings — this never silently treats `0`/`""` as missing, only `undefined`/`null`/non-finite. */
function requireProviderId(value: unknown, field: string): Result<string, ValidationError> {
  if (typeof value === "number" && Number.isFinite(value)) return ok(String(value));
  if (typeof value === "string" && value.trim().length > 0) return ok(value);
  return err(new ValidationError({ message: `${field} must be a Sportmonks numeric id or non-empty string.`, code: "SPORTMONKS_INVALID_ID", context: { field } }));
}

// ============================================================
// HTTP client — thin, injectable (tests supply a mock fetchImpl; never a
// real network call in the default test suite — see Section 13 spec's
// "deterministic fixtures/mocks only").
// ============================================================

type RawHttpOutcome = { readonly status: "ok"; readonly body: Record<string, unknown> } | { readonly status: "rate_limited"; readonly retryAfterSeconds: number | undefined } | { readonly status: "unavailable"; readonly reason: string };

async function doSportmonksRequest(config: ProviderConfig, fetchImpl: typeof fetch, path: string, query: Record<string, string>): Promise<RawHttpOutcome> {
  if (!config.apiKey) {
    return { status: "unavailable", reason: "Sportmonks API key is not configured." };
  }
  const url = new URL(`${config.baseUrl ?? DEFAULT_BASE_URL}${path}`);
  url.searchParams.set("api_token", config.apiKey);
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
    // Transient — thrown so withBoundedRetries() retries a bounded number
    // of times, never an unbounded loop (provider.ts's own contract).
    throw new Error(`Sportmonks request failed with HTTP ${response.status}.`);
  }
  if (!response.ok) {
    // A 4xx (other than 429) is not transient — retrying an auth/bad-request
    // failure cannot succeed, so this is returned as a structured
    // "unavailable" outcome, never thrown/retried.
    return { status: "unavailable", reason: `Sportmonks request failed with HTTP ${response.status}.` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: "unavailable", reason: "Sportmonks response was not valid JSON." };
  }
  if (!isRecord(body)) {
    return { status: "unavailable", reason: "Sportmonks response was not a JSON object." };
  }
  return { status: "ok", body };
}

async function fetchSportmonksList(config: ProviderConfig, fetchImpl: typeof fetch, path: string, query: Record<string, string>): Promise<ProviderFetchOutcome<RawRecord>> {
  const records: RawRecord[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const outcome = await doSportmonksRequest(config, fetchImpl, path, { ...query, page: String(page) });
    if (outcome.status !== "ok") return outcome;
    if (!Array.isArray(outcome.body.data)) {
      return { status: "unavailable", reason: "Sportmonks response did not contain a `data` array." };
    }
    records.push(...outcome.body.data.filter(isRecord));
    const pagination = isRecord(outcome.body.pagination) ? outcome.body.pagination : undefined;
    if (pagination?.has_more !== true) break;
  }
  return { status: "ok", records, fetchedAt: new Date().toISOString() };
}

type SingleResourceOutcome = { readonly status: "ok"; readonly record: RawRecord } | { readonly status: "rate_limited"; readonly retryAfterSeconds: number | undefined } | { readonly status: "unavailable"; readonly reason: string };

async function fetchSportmonksSingle(config: ProviderConfig, fetchImpl: typeof fetch, path: string, query: Record<string, string>): Promise<SingleResourceOutcome> {
  const outcome = await doSportmonksRequest(config, fetchImpl, path, query);
  if (outcome.status !== "ok") return outcome;
  if (!isRecord(outcome.body.data)) {
    return { status: "unavailable", reason: "Sportmonks response did not contain a `data` object." };
  }
  return { status: "ok", record: outcome.body.data };
}

// ============================================================
// Reference data (competitions / seasons / teams) — standalone fetch
// functions, not part of FootballDataProvider (Section 04 never declared
// a competitions/seasons facet). The caller (apps/worker's football
// ingestion job — Section 13 #188) feeds these RawRecord[] results
// directly into ingestion.ts's ingestReferenceData(), unchanged.
// ============================================================

/** One real HTTP call per configured league id — deliberately not a bulk filter call (lower confidence in an unverified multi-id filter syntax than in repeating a single, well-documented single-resource call). Bounded by the caller's own configured league list — never "fetch everything". */
export async function fetchSportmonksCompetitions(config: ProviderConfig, leagueProviderIds: readonly string[], fetchImpl: typeof fetch = fetch): Promise<ProviderFetchOutcome<RawRecord>> {
  if (leagueProviderIds.length === 0) return { status: "ok", records: [], fetchedAt: new Date().toISOString() };
  const records: RawRecord[] = [];
  for (const id of leagueProviderIds) {
    const result = await fetchSportmonksSingle(config, fetchImpl, `/leagues/${encodeURIComponent(id)}`, { include: "currentSeason" });
    if (result.status !== "ok") return result;
    records.push(result.record);
  }
  return { status: "ok", records, fetchedAt: new Date().toISOString() };
}

/** Scoped to each league's CURRENT season only — see this file's doc comment. */
export async function fetchSportmonksSeasons(config: ProviderConfig, leagueProviderIds: readonly string[], fetchImpl: typeof fetch = fetch): Promise<ProviderFetchOutcome<RawRecord>> {
  const competitions = await fetchSportmonksCompetitions(config, leagueProviderIds, fetchImpl);
  if (competitions.status !== "ok") return competitions;
  const records: RawRecord[] = [];
  for (const league of competitions.records) {
    if (!isRecord(league.currentSeason)) continue;
    // currentSeason's own payload doesn't reliably repeat league_id —
    // attach the league it was actually fetched under explicitly, never
    // guessed from elsewhere.
    records.push({ ...league.currentSeason, league_id: league.currentSeason.league_id ?? league.id });
  }
  return { status: "ok", records, fetchedAt: new Date().toISOString() };
}

async function fetchSportmonksTeamsForLeague(config: ProviderConfig, leagueProviderId: string, fetchImpl: typeof fetch): Promise<ProviderFetchOutcome<RawRecord>> {
  const result = await fetchSportmonksSingle(config, fetchImpl, `/leagues/${encodeURIComponent(leagueProviderId)}`, { include: "currentSeason.teams" });
  if (result.status !== "ok") return result;
  const currentSeason = isRecord(result.record.currentSeason) ? result.record.currentSeason : undefined;
  const teams = currentSeason && Array.isArray(currentSeason.teams) ? currentSeason.teams.filter(isRecord) : undefined;
  if (!teams) {
    return { status: "unavailable", reason: "League response did not include currentSeason.teams — this plan/league may not support the include, or has no current season." };
  }
  return { status: "ok", records: teams, fetchedAt: new Date().toISOString() };
}

// ============================================================
// FootballDataProvider facets
// ============================================================

function toSportmonksDateOnly(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function buildFixtureProvider(config: ProviderConfig, fetchImpl: typeof fetch): FootballFixtureProvider {
  return {
    provider: SPORTMONKS_PROVIDER_NAME,
    async fetchFixtures(params): Promise<ProviderFetchOutcome<RawRecord>> {
      const now = new Date().toISOString();
      // Section 13 — "never generate uncontrolled API usage": an omitted
      // since/until defaults to a single day (today), never an unbounded
      // or historically-wide range.
      const since = toSportmonksDateOnly(params.since ?? now);
      const until = toSportmonksDateOnly(params.until ?? params.since ?? now);
      const query: Record<string, string> = { include: "participants;state;scores;events.type" };
      if (params.competitionProviderId) query.filters = `fixtureLeagues:${params.competitionProviderId}`;
      return fetchSportmonksList(config, fetchImpl, `/fixtures/between/${since}/${until}`, query);
    },
  };
}

function buildTeamProvider(config: ProviderConfig, fetchImpl: typeof fetch): FootballTeamProvider {
  return {
    provider: SPORTMONKS_PROVIDER_NAME,
    async fetchTeams(params): Promise<ProviderFetchOutcome<RawRecord>> {
      if (!params.competitionProviderId) {
        return { status: "unavailable", reason: "fetchTeams requires competitionProviderId — this adapter has no global 'all teams' call." };
      }
      return fetchSportmonksTeamsForLeague(config, params.competitionProviderId, fetchImpl);
    },
  };
}

function buildEventProvider(config: ProviderConfig, fetchImpl: typeof fetch): FootballEventProvider {
  return {
    provider: SPORTMONKS_PROVIDER_NAME,
    async fetchEvents(params): Promise<ProviderFetchOutcome<RawRecord>> {
      const result = await fetchSportmonksSingle(config, fetchImpl, `/fixtures/${encodeURIComponent(params.fixtureProviderId)}`, { include: "events.type" });
      if (result.status !== "ok") return result;
      const events = Array.isArray(result.record.events) ? result.record.events.filter(isRecord) : undefined;
      if (!events) {
        return { status: "unavailable", reason: "Fixture response did not include events." };
      }
      // Not every event object repeats its own fixture_id — attach the
      // fixture it was actually fetched under explicitly.
      const withFixtureId = events.map((event) => ({ ...event, fixture_id: event.fixture_id ?? params.fixtureProviderId }));
      return { status: "ok", records: withFixtureId, fetchedAt: new Date().toISOString() };
    },
  };
}

/**
 * No `odds` facet: The Odds API is Section 13's locked canonical odds
 * provider, and Section 13 requires a "deliberate reason" to also expose
 * a Sportmonks odds facet — none is given here. No `players` facet: out
 * of scope per provider.ts's own FootballPlayerProvider doc comment
 * ("avoid premature player-level complexity").
 */
export function buildSportmonksProvider(config: ProviderConfig, fetchImpl: typeof fetch = fetch): FootballDataProvider {
  return {
    provider: SPORTMONKS_PROVIDER_NAME,
    config,
    fixtures: buildFixtureProvider(config, fetchImpl),
    teams: buildTeamProvider(config, fetchImpl),
    events: buildEventProvider(config, fetchImpl),
  };
}

// ============================================================
// Normalizers — raw (Sportmonks' own shape) -> Normalized* (canonical.js
// field names, provider-scoped refs). See this file's top doc comment
// for exactly which fields are verified vs. defensively rejected.
// ============================================================

export function normalizeSportmonksCompetition(raw: RawRecord): Result<NormalizedCompetition, ValidationError> {
  const id = requireProviderId(raw.id, "id");
  if (!id.ok) return id;
  const name = requireNonEmptyString(raw.name, "name");
  if (!name.ok) return name;
  return ok({
    provider: SPORTMONKS_PROVIDER_NAME,
    providerCompetitionId: id.value,
    name: name.value,
    country: undefined,
    competitionType: typeof raw.type === "string" ? raw.type : undefined,
    active: true,
  });
}

export function normalizeSportmonksSeason(raw: RawRecord): Result<NormalizedSeason, ValidationError> {
  const id = requireProviderId(raw.id, "id");
  if (!id.ok) return id;
  const leagueId = requireProviderId(raw.league_id, "league_id");
  if (!leagueId.ok) return leagueId;
  const name = requireNonEmptyString(raw.name, "name");
  if (!name.ok) return name;
  return ok({
    provider: SPORTMONKS_PROVIDER_NAME,
    providerSeasonId: id.value,
    providerCompetitionId: leagueId.value,
    name: name.value,
    startDate: typeof raw.starting_at === "string" ? raw.starting_at : undefined,
    endDate: typeof raw.ending_at === "string" ? raw.ending_at : undefined,
    status: raw.is_current === true ? "current" : undefined,
  });
}

export function normalizeSportmonksTeam(raw: RawRecord): Result<NormalizedTeam, ValidationError> {
  const id = requireProviderId(raw.id, "id");
  if (!id.ok) return id;
  const name = requireNonEmptyString(raw.name, "name");
  if (!name.ok) return name;
  return ok({
    provider: SPORTMONKS_PROVIDER_NAME,
    providerTeamId: id.value,
    name: name.value,
    shortName: typeof raw.short_code === "string" ? raw.short_code : undefined,
    country: undefined,
  });
}

/** See this file's top doc comment — only NS/1st/HT/BRK/FT are mapped with confidence; everything else is UNKNOWN, never guessed. */
export function normalizeSportmonksMatchStatus(stateShortName: string | undefined): MatchStatus {
  switch (stateShortName) {
    case "NS":
      return MatchStatus.SCHEDULED;
    case "1st":
      return MatchStatus.LIVE;
    case "HT":
    case "BRK":
      return MatchStatus.HALFTIME;
    case "FT":
      return MatchStatus.FINISHED;
    default:
      return MatchStatus.UNKNOWN;
  }
}

export function normalizeSportmonksFixture(raw: RawRecord): Result<NormalizedFixture, ValidationError> {
  const id = requireProviderId(raw.id, "id");
  if (!id.ok) return id;
  const leagueId = requireProviderId(raw.league_id, "league_id");
  if (!leagueId.ok) return leagueId;

  const participants = Array.isArray(raw.participants) ? raw.participants.filter(isRecord) : [];
  const home = participants.find((p) => isRecord(p.meta) && p.meta.location === "home");
  const away = participants.find((p) => isRecord(p.meta) && p.meta.location === "away");
  if (!home || !away) {
    return err(new ValidationError({ message: "Fixture is missing a home or away participant (expected participants[].meta.location).", code: "SPORTMONKS_MISSING_PARTICIPANT" }));
  }
  const homeTeamId = requireProviderId(home.id, "participants[home].id");
  if (!homeTeamId.ok) return homeTeamId;
  const awayTeamId = requireProviderId(away.id, "participants[away].id");
  if (!awayTeamId.ok) return awayTeamId;

  let scheduledKickoffAt: string;
  const timestamp = raw.starting_at_timestamp;
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    // Preferred: an unambiguous Unix epoch — never a guessed timezone.
    scheduledKickoffAt = new Date(timestamp * 1000).toISOString();
  } else if (typeof raw.starting_at === "string") {
    // Fallback: documented as UTC but formatted "YYYY-MM-DD HH:mm:ss"
    // (no timezone marker) — treated as UTC here; not independently
    // re-verified in this session (see this file's top doc comment).
    const parsed = requireValidIsoDate(`${raw.starting_at.replace(" ", "T")}Z`, "starting_at");
    if (!parsed.ok) return parsed;
    scheduledKickoffAt = parsed.value;
  } else {
    return err(new ValidationError({ message: "Fixture is missing both starting_at_timestamp and starting_at.", code: "SPORTMONKS_MISSING_KICKOFF" }));
  }

  const stateShortName = isRecord(raw.state) && typeof raw.state.short_name === "string" ? raw.state.short_name : undefined;
  const seasonId = raw.season_id !== undefined && raw.season_id !== null ? String(raw.season_id) : undefined;

  return ok({
    provider: SPORTMONKS_PROVIDER_NAME,
    providerFixtureId: id.value,
    providerCompetitionId: leagueId.value,
    providerSeasonId: seasonId,
    providerHomeTeamId: homeTeamId.value,
    providerAwayTeamId: awayTeamId.value,
    scheduledKickoffAt,
    status: normalizeSportmonksMatchStatus(stateShortName),
    providerStatusRaw: stateShortName ?? String(raw.state_id ?? "unknown"),
  });
}

function extractCurrentGoals(scores: unknown, side: "home" | "away"): number | undefined {
  if (!Array.isArray(scores)) return undefined;
  for (const entry of scores) {
    if (!isRecord(entry) || entry.description !== "CURRENT" || !isRecord(entry.score)) continue;
    if (entry.score.participant !== side) continue;
    const goals = entry.score.goals;
    if (typeof goals === "number" && Number.isInteger(goals) && goals >= 0) return goals;
  }
  return undefined;
}

/**
 * Derived from the SAME fixture payload used by normalizeSportmonksFixture
 * (via its `scores` include) — Sportmonks has no separate "results"
 * endpoint. `observedAtFallback` is OUR ingestion-time observation, not a
 * Sportmonks-supplied timestamp — see this file's top doc comment.
 */
export function normalizeSportmonksMatchResult(raw: RawRecord, observedAtFallback: string): Result<NormalizedMatchResult, ValidationError> {
  const id = requireProviderId(raw.id, "id");
  if (!id.ok) return id;
  const homeGoals = extractCurrentGoals(raw.scores, "home");
  const awayGoals = extractCurrentGoals(raw.scores, "away");
  if (homeGoals === undefined || awayGoals === undefined) {
    return err(new ValidationError({ message: "Fixture does not have a CURRENT score for both participants (expected scores[].description === 'CURRENT').", code: "SPORTMONKS_MISSING_SCORE" }));
  }
  return ok({
    providerFixtureId: id.value,
    homeGoals,
    awayGoals,
    halftimeHomeGoals: undefined,
    halftimeAwayGoals: undefined,
    resultRecordedAt: observedAtFallback,
    source: SPORTMONKS_PROVIDER_NAME,
  });
}

const EVENT_TYPE_KEYWORDS: ReadonlyArray<{ readonly test: (name: string) => boolean; readonly eventType: MatchEventType }> = [
  { test: (n) => n.includes("own goal"), eventType: "own_goal" },
  { test: (n) => n.includes("penalty") && n.includes("miss"), eventType: "missed_penalty" },
  { test: (n) => n.includes("penalty"), eventType: "penalty_goal" },
  { test: (n) => n.includes("goal"), eventType: "goal" },
  { test: (n) => n.includes("yellow"), eventType: "yellow_card" },
  { test: (n) => n.includes("red"), eventType: "red_card" },
  { test: (n) => n.includes("substitution"), eventType: "substitution" },
  { test: (n) => n.includes("var"), eventType: "var" },
];

function classifySportmonksEventType(raw: RawRecord): MatchEventType | undefined {
  const typeName = isRecord(raw.type) && typeof raw.type.name === "string" ? raw.type.name.toLowerCase() : undefined;
  if (!typeName) return undefined;
  return EVENT_TYPE_KEYWORDS.find((candidate) => candidate.test(typeName))?.eventType;
}

/** `observedAtFallback` is OUR ingestion-time observation — Sportmonks events carry a `minute`, not a wall-clock timestamp this adapter could verify. */
export function normalizeSportmonksMatchEvent(raw: RawRecord, observedAtFallback: string): Result<NormalizedMatchEvent, ValidationError> {
  const fixtureId = requireProviderId(raw.fixture_id, "fixture_id");
  if (!fixtureId.ok) return fixtureId;

  const eventType = classifySportmonksEventType(raw);
  if (!eventType) {
    return err(new ValidationError({ message: "Could not classify Sportmonks event type from `type.name` (missing or unrecognized) — never guessed.", code: "SPORTMONKS_UNRECOGNIZED_EVENT_TYPE" }));
  }

  const providerEventId = requireProviderId(raw.id, "id");
  const providerTeamId = raw.participant_id !== undefined ? requireProviderId(raw.participant_id, "participant_id") : undefined;
  const minute = typeof raw.minute === "number" && Number.isInteger(raw.minute) && raw.minute >= 0 ? raw.minute : undefined;

  return ok({
    provider: SPORTMONKS_PROVIDER_NAME,
    providerEventId: providerEventId.ok ? providerEventId.value : undefined,
    providerFixtureId: fixtureId.value,
    eventType,
    providerEventType: isRecord(raw.type) && typeof raw.type.name === "string" ? raw.type.name : "unknown",
    providerTeamId: providerTeamId?.ok ? providerTeamId.value : undefined,
    minute,
    observedAt: observedAtFallback,
  });
}
