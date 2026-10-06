import {
  fetchOddsApiLiveOdds,
  ingestOddsObservations,
  normalizeOddsApiOdds,
  ODDS_API_PROVIDER_NAME,
  type Fixture,
  type FixtureExternalIdentitiesRepository,
  type IngestionDependencies,
  type ProviderConfig,
  type RawRecord,
} from "@sport-os/football-engine";
import { OperationalJobType, type OperationalJobRecord } from "@sport-os/platform";
import type { JobHandler, JobHandlerResult } from "../worker.js";
import { fetchProviderRecordsWithRetries } from "./shared.js";

/**
 * How far before/after a candidate Sportmonks fixture's own
 * `scheduledKickoffAt` this job will still consider it a reconciliation
 * candidate for an Odds API event's `commence_time`. Deliberately tight
 * (not a whole day) — Section 13: "never merge fixtures based on
 * similar names/times/leagues alone"; the window only narrows the
 * CANDIDATE set, the actual confirmation is still the team-name match
 * below, and a window this tight already keeps unrelated same-day
 * fixtures out of contention.
 */
const RECONCILIATION_WINDOW_MS = 30 * 60 * 1000;

const MATCH_METHOD = "team_name_kickoff_time";

/** Lowercase, trim, collapse whitespace, drop a trailing "fc"/"cf" club suffix — an approximate normalization, not a guaranteed-correct one; see this file's doc comment and FOOTBALL_PROVIDER_INTEGRATION.md's "Known Limitations". */
function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\b(fc|cf)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

type ReconciliationOutcome = "matched" | "no_candidate" | "ambiguous" | "incomplete_event";

/**
 * FOOTBALL_ODDS_INGESTION (Section 13). Fetches The Odds API's current
 * odds for the configured sport keys, performs fixture identity
 * reconciliation against ALREADY-INGESTED Sportmonks fixtures (team
 * name + kickoff-time window — see RECONCILIATION_WINDOW_MS above),
 * records a confirmed `fixture_external_identities` mapping for exactly
 * one candidate match, quarantines zero or multiple candidates (NEVER
 * guesses), then calls `ingestOddsObservations` — unchanged — with the
 * resolver so reconciled events' odds land on the correct internal
 * fixture.
 *
 * Only events this run successfully reconciled (or that were already
 * mapped from a prior run) are fed into `ingestOddsObservations` — an
 * event this run failed to reconcile is already quarantined with a
 * precise reason here, so it is deliberately excluded rather than also
 * being quarantined a second time by ingestOddsObservations's own
 * generic "fixture not found" path.
 *
 * `sportKeys` is supplied by the caller (`config.providers.odds.selectedIds`
 * — `ODDS_SPORT_KEYS`), never hard-coded here. Disabled provider or an
 * empty list safely no-ops.
 */
export class FootballOddsIngestionJobHandler implements JobHandler {
  readonly jobType: OperationalJobType = OperationalJobType.FOOTBALL_ODDS_INGESTION;

  constructor(
    private readonly deps: IngestionDependencies,
    private readonly identities: FixtureExternalIdentitiesRepository,
    private readonly oddsConfig: ProviderConfig,
    private readonly sportKeys: readonly string[],
    /** Injectable for testing — defaults to the global fetch. */
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async handle(_job: OperationalJobRecord): Promise<JobHandlerResult> {
    if (!this.oddsConfig.enabled || this.sportKeys.length === 0) {
      return { ok: true };
    }

    const deps = this.deps;
    const identities = this.identities;
    const now = new Date();

    const allRecords: RawRecord[] = [];
    for (const sportKey of this.sportKeys) {
      const fetchResult = await fetchProviderRecordsWithRetries(() => fetchOddsApiLiveOdds(this.oddsConfig, sportKey, this.fetchImpl), this.oddsConfig.maxRetries, `The Odds API live odds fetch (sport ${sportKey})`);
      if (!fetchResult.ok) return fetchResult.failure;
      allRecords.push(...fetchResult.records);
    }
    if (allRecords.length === 0) return { ok: true };

    const eventGroups = new Map<string, RawRecord[]>();
    for (const record of allRecords) {
      const eventId = typeof record.event_id === "string" ? record.event_id : undefined;
      if (!eventId) continue; // malformed — left for normalizeOddsApiOdds's own per-record validation to reject if it ever reaches ingestion.
      const group = eventGroups.get(eventId);
      if (group) group.push(record);
      else eventGroups.set(eventId, [record]);
    }

    const reconciledEventIds = new Set<string>();

    for (const [eventId, records] of eventGroups) {
      const existingFixtureId = await identities.resolve(ODDS_API_PROVIDER_NAME, eventId);
      if (existingFixtureId) {
        reconciledEventIds.add(eventId);
        continue;
      }

      const sample = records[0]!;
      const homeTeam = typeof sample.home_team === "string" ? sample.home_team : undefined;
      const awayTeam = typeof sample.away_team === "string" ? sample.away_team : undefined;
      const commenceTime = typeof sample.commence_time === "string" ? sample.commence_time : undefined;

      const outcome = await this.reconcileFixtureIdentity(deps, identities, eventId, homeTeam, awayTeam, commenceTime);
      if (outcome === "matched") reconciledEventIds.add(eventId);
      // "no_candidate"/"ambiguous"/"incomplete_event" are already
      // quarantined inside reconcileFixtureIdentity — left unmapped,
      // excluded from ingestOddsObservations below.
    }

    const reconciledRecords = allRecords.filter((record) => typeof record.event_id === "string" && reconciledEventIds.has(record.event_id));
    if (reconciledRecords.length === 0) return { ok: true };

    await ingestOddsObservations(deps, ODDS_API_PROVIDER_NAME, "live", reconciledRecords, (raw) => normalizeOddsApiOdds(raw, now.toISOString()), identities);

    return { ok: true };
  }

  private async reconcileFixtureIdentity(
    deps: IngestionDependencies,
    identities: FixtureExternalIdentitiesRepository,
    eventId: string,
    homeTeam: string | undefined,
    awayTeam: string | undefined,
    commenceTime: string | undefined,
  ): Promise<ReconciliationOutcome> {
    if (!homeTeam || !awayTeam || !commenceTime) {
      await deps.quarantine.quarantine({
        provider: ODDS_API_PROVIDER_NAME,
        providerRecordId: eventId,
        entityType: "odds_observation",
        reason: "Event is missing home_team/away_team/commence_time — cannot attempt identity reconciliation.",
        rawPayload: { event_id: eventId, home_team: homeTeam, away_team: awayTeam, commence_time: commenceTime },
        ingestionRunId: undefined,
      });
      return "incomplete_event";
    }

    const commenceMs = new Date(commenceTime).getTime();
    const windowFrom = new Date(commenceMs - RECONCILIATION_WINDOW_MS).toISOString();
    const windowTo = new Date(commenceMs + RECONCILIATION_WINDOW_MS).toISOString();
    const candidates = await deps.fixtures.listByKickoffWindow(windowFrom, windowTo);

    const normalizedHome = normalizeTeamName(homeTeam);
    const normalizedAway = normalizeTeamName(awayTeam);
    const matches: Fixture[] = [];
    for (const candidate of candidates) {
      const [home, away] = await Promise.all([deps.teams.getById(candidate.homeTeamId), deps.teams.getById(candidate.awayTeamId)]);
      if (!home || !away) continue;
      if (normalizeTeamName(home.name) === normalizedHome && normalizeTeamName(away.name) === normalizedAway) {
        matches.push(candidate);
      }
    }

    if (matches.length === 0) {
      await deps.quarantine.quarantine({
        provider: ODDS_API_PROVIDER_NAME,
        providerRecordId: eventId,
        entityType: "odds_observation",
        reason: `No candidate Sportmonks fixture matched team names "${homeTeam}" vs "${awayTeam}" within the kickoff window.`,
        rawPayload: { event_id: eventId, home_team: homeTeam, away_team: awayTeam, commence_time: commenceTime },
        ingestionRunId: undefined,
      });
      return "no_candidate";
    }
    if (matches.length > 1) {
      await deps.quarantine.quarantine({
        provider: ODDS_API_PROVIDER_NAME,
        providerRecordId: eventId,
        entityType: "odds_observation",
        reason: `Ambiguous match: ${matches.length} candidate Sportmonks fixtures matched team names "${homeTeam}" vs "${awayTeam}" within the kickoff window — never guessed.`,
        rawPayload: { event_id: eventId, home_team: homeTeam, away_team: awayTeam, commence_time: commenceTime, candidateFixtureIds: matches.map((m) => m.id) },
        ingestionRunId: undefined,
      });
      return "ambiguous";
    }

    await identities.recordMapping({ fixtureId: matches[0]!.id, provider: ODDS_API_PROVIDER_NAME, providerFixtureId: eventId, matchMethod: MATCH_METHOD });
    return "matched";
  }
}
