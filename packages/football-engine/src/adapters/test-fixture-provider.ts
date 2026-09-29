import { err, ok, ValidationError, type Result } from "@sport-os/shared";
import { normalizeCommonMatchStatus, TemporalReliability } from "../canonical.js";
import {
  requireNonEmptyString,
  requireNonNegativeInt,
  requirePositiveNumber,
  requireValidIsoDate,
  type NormalizedCompetition,
  type NormalizedFixture,
  type NormalizedMatchEvent,
  type NormalizedMatchResult,
  type NormalizedOddsObservation,
  type NormalizedSeason,
  type NormalizedTeam,
} from "../normalize.js";
import type { FootballDataProvider, FootballFixtureProvider, ProviderConfig, ProviderFetchOutcome, RawRecord } from "../provider.js";

/**
 * The ONE provider adapter this section ships (Section 04 — Provider
 * Configuration: "If no provider credential exists in the repository/
 * environment: implement the adapter contract and deterministic test
 * fixtures. Do NOT pretend a live provider is connected."). No live
 * football/odds provider credential exists in this repository or
 * environment — see docs/architecture/FOOTBALL_DATA_ARCHITECTURE.md's
 * "Providers actually connected" for the explicit statement.
 *
 * `provider: "test_fixture_provider"` namespaces every row this adapter
 * ever produces — trivially distinguishable and filterable from any
 * real provider's data by that column alone (never mixed by convention
 * only). This is real, working code (not a `.test.ts` file) because it
 * is the legitimate adapter used for local ingestion runs and the
 * adapter-contract test suite alike — the same pattern Section 02 used
 * for its gated dev-auth identity.
 *
 * The raw record shape below (`kind`, `status_code` using football-
 * data.org-style short codes, etc.) is this adapter's own invented
 * convention — demonstrating the full raw -> normalized pattern a real
 * provider's adapter would follow, not a verified real provider format.
 */
export const TEST_FIXTURE_PROVIDER_NAME = "test_fixture_provider";

// ============================================================
// Deterministic dataset (Section 04 — Fixture Dataset). Every category
// the spec requires is represented; nothing here is ever inserted
// without going through normalization + DataQualityEngine like any
// other provider's data would be.
// ============================================================

const RAW_COMPETITIONS: RawRecord[] = [
  { kind: "competition", id: "TFP-COMP-1", name: "Test Premier League", country: "Testland", type: "league" },
  { kind: "competition", id: "TFP-COMP-2", name: "Test Championship", country: "Testland", type: "league" },
];

const RAW_SEASONS: RawRecord[] = [
  { kind: "season", id: "TFP-SEASON-1", competition_id: "TFP-COMP-1", name: "2025/2026", start_date: "2025-08-01", end_date: "2026-05-31", status: "active" },
  { kind: "season", id: "TFP-SEASON-2", competition_id: "TFP-COMP-2", name: "2025/2026", start_date: "2025-08-01", end_date: "2026-05-31", status: "active" },
];

const RAW_TEAMS: RawRecord[] = [
  { kind: "team", id: "TFP-TEAM-1", name: "Test Arsenal", short_name: "TAR", country: "Testland" },
  { kind: "team", id: "TFP-TEAM-2", name: "Test Chelsea", short_name: "TCH", country: "Testland" },
  { kind: "team", id: "TFP-TEAM-3", name: "Test United", short_name: "TUN", country: "Testland" },
  { kind: "team", id: "TFP-TEAM-4", name: "Test City", short_name: "TCI", country: "Testland" },
];

const RAW_FIXTURES: RawRecord[] = [
  // Completed matches
  {
    kind: "fixture",
    id: "TFP-FIX-1",
    competition_id: "TFP-COMP-1",
    season_id: "TFP-SEASON-1",
    home_team_id: "TFP-TEAM-1",
    away_team_id: "TFP-TEAM-2",
    kickoff_utc: "2026-01-10T19:00:00Z",
    status_code: "FT",
  },
  {
    kind: "fixture",
    id: "TFP-FIX-2",
    competition_id: "TFP-COMP-1",
    season_id: "TFP-SEASON-1",
    home_team_id: "TFP-TEAM-3",
    away_team_id: "TFP-TEAM-4",
    kickoff_utc: "2026-01-05T15:00:00Z",
    status_code: "FT",
  },
  // Upcoming matches
  {
    kind: "fixture",
    id: "TFP-FIX-3",
    competition_id: "TFP-COMP-1",
    season_id: "TFP-SEASON-1",
    home_team_id: "TFP-TEAM-2",
    away_team_id: "TFP-TEAM-3",
    kickoff_utc: "2026-03-01T19:00:00Z",
    status_code: "NS",
  },
  {
    kind: "fixture",
    id: "TFP-FIX-4",
    competition_id: "TFP-COMP-2",
    season_id: "TFP-SEASON-2",
    home_team_id: "TFP-TEAM-4",
    away_team_id: "TFP-TEAM-1",
    kickoff_utc: "2026-03-08T15:00:00Z",
    status_code: "NS",
  },
  // Postponed
  {
    kind: "fixture",
    id: "TFP-FIX-5",
    competition_id: "TFP-COMP-2",
    season_id: "TFP-SEASON-2",
    home_team_id: "TFP-TEAM-1",
    away_team_id: "TFP-TEAM-3",
    kickoff_utc: "2026-02-14T15:00:00Z",
    status_code: "PST",
  },
  // Cancelled
  {
    kind: "fixture",
    id: "TFP-FIX-6",
    competition_id: "TFP-COMP-2",
    season_id: "TFP-SEASON-2",
    home_team_id: "TFP-TEAM-2",
    away_team_id: "TFP-TEAM-4",
    kickoff_utc: "2026-02-20T15:00:00Z",
    status_code: "CANC",
  },
  // Deliberately duplicated record (same provider id as TFP-FIX-1) — exercises idempotent upsert handling.
  {
    kind: "fixture",
    id: "TFP-FIX-1",
    competition_id: "TFP-COMP-1",
    season_id: "TFP-SEASON-1",
    home_team_id: "TFP-TEAM-1",
    away_team_id: "TFP-TEAM-2",
    kickoff_utc: "2026-01-10T19:00:00Z",
    status_code: "FT",
  },
  // Deliberately invalid record: home and away team are the same — must be rejected/quarantined, never inserted.
  {
    kind: "fixture",
    id: "TFP-FIX-INVALID-1",
    competition_id: "TFP-COMP-1",
    season_id: "TFP-SEASON-1",
    home_team_id: "TFP-TEAM-1",
    away_team_id: "TFP-TEAM-1",
    kickoff_utc: "2026-03-15T19:00:00Z",
    status_code: "NS",
  },
  // Deliberately invalid record: missing kickoff_utc entirely.
  {
    kind: "fixture",
    id: "TFP-FIX-INVALID-2",
    competition_id: "TFP-COMP-1",
    season_id: "TFP-SEASON-1",
    home_team_id: "TFP-TEAM-2",
    away_team_id: "TFP-TEAM-4",
    status_code: "NS",
  },
];

const RAW_MATCH_RESULTS: RawRecord[] = [
  { kind: "result", fixture_id: "TFP-FIX-1", home_goals: 2, away_goals: 1, halftime_home_goals: 1, halftime_away_goals: 0, recorded_at: "2026-01-10T20:55:00Z" },
  { kind: "result", fixture_id: "TFP-FIX-2", home_goals: 0, away_goals: 0, halftime_home_goals: 0, halftime_away_goals: 0, recorded_at: "2026-01-05T16:50:00Z" },
];

const RAW_MATCH_EVENTS: RawRecord[] = [
  { kind: "event", id: "TFP-EVT-1", fixture_id: "TFP-FIX-1", type_code: "GOAL", team_id: "TFP-TEAM-1", minute: 23, observed_at: "2026-01-10T19:23:00Z" },
  { kind: "event", id: "TFP-EVT-2", fixture_id: "TFP-FIX-1", type_code: "YELLOW_CARD", team_id: "TFP-TEAM-2", minute: 41, observed_at: "2026-01-10T19:41:00Z" },
];

const RAW_ODDS: RawRecord[] = [
  // Pre-kickoff observations (before TFP-FIX-1's 19:00 kickoff)
  { kind: "odds", fixture_id: "TFP-FIX-1", market_type: "match_result_1x2", selection: "home", odds: 2.1, bookmaker: "test_bookmaker", observed_at: "2026-01-10T17:00:00Z", published_at: "2026-01-10T16:55:00Z" },
  { kind: "odds", fixture_id: "TFP-FIX-1", market_type: "match_result_1x2", selection: "home", odds: 2.2, bookmaker: "test_bookmaker", observed_at: "2026-01-10T18:30:00Z", published_at: "2026-01-10T18:25:00Z" },
  // No provider_published_at — must normalize with temporalReliability "estimated".
  { kind: "odds", fixture_id: "TFP-FIX-1", market_type: "over_under", selection: "over_2.5", odds: 1.85, bookmaker: "test_bookmaker_2", observed_at: "2026-01-10T18:45:00Z" },
  // Post-kickoff observation — must never enter a pre-kickoff snapshot.
  { kind: "odds", fixture_id: "TFP-FIX-1", market_type: "match_result_1x2", selection: "home", odds: 2.5, bookmaker: "test_bookmaker", observed_at: "2026-01-10T19:30:00Z", published_at: "2026-01-10T19:29:00Z" },
];

// ============================================================
// Normalizers — raw (this adapter's own shape) -> Normalized* (canonical.js field names, provider-scoped refs)
// ============================================================

export function normalizeTestFixtureCompetition(raw: RawRecord): Result<NormalizedCompetition, ValidationError> {
  const id = requireNonEmptyString(raw.id, "id");
  if (!id.ok) return id;
  const name = requireNonEmptyString(raw.name, "name");
  if (!name.ok) return name;
  return ok({
    provider: TEST_FIXTURE_PROVIDER_NAME,
    providerCompetitionId: id.value,
    name: name.value,
    country: typeof raw.country === "string" ? raw.country : undefined,
    competitionType: typeof raw.type === "string" ? raw.type : undefined,
    active: true,
  });
}

export function normalizeTestFixtureSeason(raw: RawRecord): Result<NormalizedSeason, ValidationError> {
  const id = requireNonEmptyString(raw.id, "id");
  if (!id.ok) return id;
  const competitionId = requireNonEmptyString(raw.competition_id, "competition_id");
  if (!competitionId.ok) return competitionId;
  const name = requireNonEmptyString(raw.name, "name");
  if (!name.ok) return name;
  return ok({
    provider: TEST_FIXTURE_PROVIDER_NAME,
    providerSeasonId: id.value,
    providerCompetitionId: competitionId.value,
    name: name.value,
    startDate: typeof raw.start_date === "string" ? raw.start_date : undefined,
    endDate: typeof raw.end_date === "string" ? raw.end_date : undefined,
    status: typeof raw.status === "string" ? raw.status : undefined,
  });
}

export function normalizeTestFixtureTeam(raw: RawRecord): Result<NormalizedTeam, ValidationError> {
  const id = requireNonEmptyString(raw.id, "id");
  if (!id.ok) return id;
  const name = requireNonEmptyString(raw.name, "name");
  if (!name.ok) return name;
  return ok({
    provider: TEST_FIXTURE_PROVIDER_NAME,
    providerTeamId: id.value,
    name: name.value,
    shortName: typeof raw.short_name === "string" ? raw.short_name : undefined,
    country: typeof raw.country === "string" ? raw.country : undefined,
  });
}

export function normalizeTestFixtureFixture(raw: RawRecord): Result<NormalizedFixture, ValidationError> {
  const id = requireNonEmptyString(raw.id, "id");
  if (!id.ok) return id;
  const competitionId = requireNonEmptyString(raw.competition_id, "competition_id");
  if (!competitionId.ok) return competitionId;
  const homeTeamId = requireNonEmptyString(raw.home_team_id, "home_team_id");
  if (!homeTeamId.ok) return homeTeamId;
  const awayTeamId = requireNonEmptyString(raw.away_team_id, "away_team_id");
  if (!awayTeamId.ok) return awayTeamId;
  if (homeTeamId.value === awayTeamId.value) {
    return err(new ValidationError({ message: "Fixture must have two distinct teams.", code: "NORMALIZE_DUPLICATE_TEAMS", context: { fixtureProviderId: id.value } }));
  }
  const kickoff = requireValidIsoDate(raw.kickoff_utc, "kickoff_utc");
  if (!kickoff.ok) return kickoff;
  const statusCode = requireNonEmptyString(raw.status_code, "status_code");
  if (!statusCode.ok) return statusCode;

  return ok({
    provider: TEST_FIXTURE_PROVIDER_NAME,
    providerFixtureId: id.value,
    providerCompetitionId: competitionId.value,
    providerSeasonId: typeof raw.season_id === "string" ? raw.season_id : undefined,
    providerHomeTeamId: homeTeamId.value,
    providerAwayTeamId: awayTeamId.value,
    scheduledKickoffAt: kickoff.value,
    status: normalizeCommonMatchStatus(statusCode.value),
    providerStatusRaw: statusCode.value,
  });
}

export function normalizeTestFixtureMatchResult(raw: RawRecord): Result<NormalizedMatchResult, ValidationError> {
  const fixtureId = requireNonEmptyString(raw.fixture_id, "fixture_id");
  if (!fixtureId.ok) return fixtureId;
  const homeGoals = requireNonNegativeInt(raw.home_goals, "home_goals");
  if (!homeGoals.ok) return homeGoals;
  const awayGoals = requireNonNegativeInt(raw.away_goals, "away_goals");
  if (!awayGoals.ok) return awayGoals;
  const recordedAt = requireValidIsoDate(raw.recorded_at, "recorded_at");
  if (!recordedAt.ok) return recordedAt;

  return ok({
    providerFixtureId: fixtureId.value,
    homeGoals: homeGoals.value,
    awayGoals: awayGoals.value,
    halftimeHomeGoals: typeof raw.halftime_home_goals === "number" ? raw.halftime_home_goals : undefined,
    halftimeAwayGoals: typeof raw.halftime_away_goals === "number" ? raw.halftime_away_goals : undefined,
    resultRecordedAt: recordedAt.value,
    source: TEST_FIXTURE_PROVIDER_NAME,
  });
}

const RAW_EVENT_TYPE_MAP: Record<string, NormalizedMatchEvent["eventType"]> = {
  GOAL: "goal",
  OWN_GOAL: "own_goal",
  PENALTY_GOAL: "penalty_goal",
  MISSED_PENALTY: "missed_penalty",
  YELLOW_CARD: "yellow_card",
  RED_CARD: "red_card",
  SUBSTITUTION: "substitution",
  VAR: "var",
};

export function normalizeTestFixtureMatchEvent(raw: RawRecord): Result<NormalizedMatchEvent, ValidationError> {
  const fixtureId = requireNonEmptyString(raw.fixture_id, "fixture_id");
  if (!fixtureId.ok) return fixtureId;
  const typeCode = requireNonEmptyString(raw.type_code, "type_code");
  if (!typeCode.ok) return typeCode;
  const eventType = RAW_EVENT_TYPE_MAP[typeCode.value];
  if (!eventType) {
    return err(new ValidationError({ message: "Unrecognized event type_code.", code: "NORMALIZE_INVALID_FIELD", context: { typeCode: typeCode.value } }));
  }
  const observedAt = requireValidIsoDate(raw.observed_at, "observed_at");
  if (!observedAt.ok) return observedAt;

  return ok({
    provider: TEST_FIXTURE_PROVIDER_NAME,
    providerEventId: typeof raw.id === "string" ? raw.id : undefined,
    providerFixtureId: fixtureId.value,
    eventType,
    providerEventType: typeCode.value,
    providerTeamId: typeof raw.team_id === "string" ? raw.team_id : undefined,
    minute: typeof raw.minute === "number" ? raw.minute : undefined,
    observedAt: observedAt.value,
  });
}

export function normalizeTestFixtureOdds(raw: RawRecord): Result<NormalizedOddsObservation, ValidationError> {
  const fixtureId = requireNonEmptyString(raw.fixture_id, "fixture_id");
  if (!fixtureId.ok) return fixtureId;
  const marketType = requireNonEmptyString(raw.market_type, "market_type");
  if (!marketType.ok) return marketType;
  const selection = requireNonEmptyString(raw.selection, "selection");
  if (!selection.ok) return selection;
  const odds = requirePositiveNumber(raw.odds, "odds");
  if (!odds.ok) return odds;
  const bookmaker = requireNonEmptyString(raw.bookmaker, "bookmaker");
  if (!bookmaker.ok) return bookmaker;
  const observedAt = requireValidIsoDate(raw.observed_at, "observed_at");
  if (!observedAt.ok) return observedAt;

  const publishedAtRaw = raw.published_at;
  let providerPublishedAt: string | undefined;
  if (publishedAtRaw !== undefined) {
    const publishedAt = requireValidIsoDate(publishedAtRaw, "published_at");
    if (!publishedAt.ok) return publishedAt;
    providerPublishedAt = publishedAt.value;
  }

  return ok({
    provider: TEST_FIXTURE_PROVIDER_NAME,
    providerObservationId: undefined,
    providerFixtureId: fixtureId.value,
    marketType: marketType.value,
    selection: selection.value,
    odds: odds.value,
    bookmakerSource: bookmaker.value,
    observedAt: observedAt.value,
    providerPublishedAt,
    // "If provider timestamp is unavailable, mark the observation's
    // temporal reliability as limited" — this is the one place that rule
    // is actually applied.
    temporalReliability: providerPublishedAt !== undefined ? TemporalReliability.CONFIRMED : TemporalReliability.ESTIMATED,
  });
}

// ============================================================
// The adapter itself
// ============================================================

function buildConfig(): ProviderConfig {
  return {
    provider: TEST_FIXTURE_PROVIDER_NAME,
    enabled: true,
    baseUrl: undefined,
    apiKey: undefined,
    timeoutMs: 5_000,
    maxRetries: 2,
    rateLimitPerMinute: undefined,
    pollIntervalSeconds: undefined,
  };
}

const fixtureProvider: FootballFixtureProvider = {
  provider: TEST_FIXTURE_PROVIDER_NAME,
  async fetchFixtures(): Promise<ProviderFetchOutcome<RawRecord>> {
    return { status: "ok", records: RAW_FIXTURES, fetchedAt: new Date().toISOString() };
  },
};

/** All raw records this adapter can supply, grouped by kind — used directly by ingestion.ts and by tests that need the underlying data without going through a fetch call. */
export const TEST_FIXTURE_PROVIDER_RAW_DATA = {
  competitions: RAW_COMPETITIONS,
  seasons: RAW_SEASONS,
  teams: RAW_TEAMS,
  fixtures: RAW_FIXTURES,
  matchResults: RAW_MATCH_RESULTS,
  matchEvents: RAW_MATCH_EVENTS,
  odds: RAW_ODDS,
} as const;

export const testFixtureProvider: FootballDataProvider = {
  provider: TEST_FIXTURE_PROVIDER_NAME,
  config: buildConfig(),
  fixtures: fixtureProvider,
};
