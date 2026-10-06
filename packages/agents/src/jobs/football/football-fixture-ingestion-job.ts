import {
  buildSportmonksProvider,
  ingestFixtures,
  ingestMatchEvents,
  ingestMatchResults,
  normalizeSportmonksFixture,
  normalizeSportmonksMatchEvent,
  normalizeSportmonksMatchResult,
  SPORTMONKS_PROVIDER_NAME,
  type FootballDataProvider,
  type FootballFixtureProvider,
  type IngestionDependencies,
  type ProviderConfig,
  type ProviderFetchOutcome,
  type RawRecord,
} from "@sport-os/football-engine";
import { OperationalJobType, type OperationalJobRecord } from "@sport-os/platform";
import type { JobHandler, JobHandlerResult } from "../worker.js";
import { fetchProviderRecordsWithRetries, isRecord } from "./shared.js";

/**
 * Section 13 — "never generate uncontrolled API usage... never hard-code
 * aggressive polling": a conservative, fixed lookahead window, not
 * configurable this pass (no dedicated env var exists for it — adding
 * one would be easy but is not yet justified by an actual operational
 * need). The worker's own scheduler cadence (`FOOTBALL_DATA_POLL_INTERVAL_SECONDS`)
 * governs how OFTEN this window is re-fetched; this constant only bounds
 * how FAR ahead each individual fetch looks.
 */
const FIXTURE_LOOKAHEAD_DAYS = 3;

function extractFixtureEvents(fixtureRaw: RawRecord): RawRecord[] {
  if (!Array.isArray(fixtureRaw.events)) return [];
  return fixtureRaw.events.filter(isRecord).map((event) => ({ ...event, fixture_id: event.fixture_id ?? fixtureRaw.id }));
}

/** Replays an already-fetched outcome rather than calling the network again — `ingestFixtures` always fetches through a `FootballFixtureProvider`, but this job already has the records (fetched once, reused for fixtures/results/events) and must not fetch them twice. */
function replayFixtureProvider(outcome: ProviderFetchOutcome<RawRecord>): FootballFixtureProvider {
  return { provider: SPORTMONKS_PROVIDER_NAME, async fetchFixtures() { return outcome; } };
}

/**
 * FOOTBALL_FIXTURE_INGESTION (Section 13). One Sportmonks fixture payload
 * (fetched with `include=participants;state;scores;events.type`) already
 * carries fixture identity/status, the current/final score, AND match
 * events — this handler fetches it ONCE per configured league and feeds
 * the SAME raw records into `ingestFixtures`, `ingestMatchResults`, and
 * `ingestMatchEvents` (all three reused completely unchanged), rather
 * than making three separate Sportmonks calls.
 *
 * `leagueProviderIds` is supplied by the caller exactly like
 * FOOTBALL_REFERENCE_INGESTION's — never hard-coded here. Disabled
 * provider or empty list safely no-ops.
 */
export class FootballFixtureIngestionJobHandler implements JobHandler {
  readonly jobType: OperationalJobType = OperationalJobType.FOOTBALL_FIXTURE_INGESTION;

  constructor(
    private readonly deps: IngestionDependencies,
    private readonly footballConfig: ProviderConfig,
    private readonly leagueProviderIds: readonly string[],
    /** Injectable for testing — defaults to the global fetch. */
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async handle(_job: OperationalJobRecord): Promise<JobHandlerResult> {
    if (!this.footballConfig.enabled || this.leagueProviderIds.length === 0) {
      return { ok: true };
    }

    const deps = this.deps;
    const sportmonksProvider = buildSportmonksProvider(this.footballConfig, this.fetchImpl);
    const now = new Date();
    const since = now.toISOString();
    const until = new Date(now.getTime() + FIXTURE_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000).toISOString();

    for (const leagueId of this.leagueProviderIds) {
      const fetchResult = await fetchProviderRecordsWithRetries(
        () => sportmonksProvider.fixtures!.fetchFixtures({ since, until, competitionProviderId: leagueId }),
        this.footballConfig.maxRetries,
        `Sportmonks fixtures fetch (league ${leagueId})`,
      );
      // One league's failure does not abort the others — leagues that
      // already succeeded this run keep their committed ingestion;
      // the job as a whole still reports failure (below) so the job
      // system retries, bounded by its own maxAttempts.
      if (!fetchResult.ok) {
        return fetchResult.failure;
      }

      const fixtureRecords = fetchResult.records;
      if (fixtureRecords.length === 0) continue;

      const replayDataProvider: FootballDataProvider = { provider: SPORTMONKS_PROVIDER_NAME, config: this.footballConfig, fixtures: replayFixtureProvider({ status: "ok", records: fixtureRecords, fetchedAt: now.toISOString() }) };

      await ingestFixtures(deps, replayDataProvider, normalizeSportmonksFixture, "live", { since, until, competitionProviderId: leagueId });
      await ingestMatchResults(deps, SPORTMONKS_PROVIDER_NAME, "live", fixtureRecords, (raw) => normalizeSportmonksMatchResult(raw, now.toISOString()));

      const eventRecords = fixtureRecords.flatMap(extractFixtureEvents);
      if (eventRecords.length > 0) {
        await ingestMatchEvents(deps, SPORTMONKS_PROVIDER_NAME, "live", eventRecords, (raw) => normalizeSportmonksMatchEvent(raw, now.toISOString()));
      }
    }

    return { ok: true };
  }
}
