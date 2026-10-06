import { withBoundedRetries, type IngestionDependencies, type ProviderFetchOutcome, type RawRecord } from "@sport-os/football-engine";
import {
  SupabaseCompetitionsRepository,
  SupabaseFixturesRepository,
  SupabaseIngestionRunsRepository,
  SupabaseMatchEventsRepository,
  SupabaseMatchResultsRepository,
  SupabaseOddsObservationsRepository,
  SupabaseQuarantineRepository,
  SupabaseSeasonsRepository,
  SupabaseTeamObservationsRepository,
  SupabaseTeamsRepository,
} from "@sport-os/football-engine";
import { JobFailureCategory, type SupabaseClient } from "@sport-os/platform";
import type { JobHandlerResult } from "../worker.js";

/** Shared across all Section 13 football ingestion job handlers — never duplicated per handler. */

export function buildFootballIngestionDependencies(client: SupabaseClient): IngestionDependencies {
  return {
    competitions: new SupabaseCompetitionsRepository(client),
    seasons: new SupabaseSeasonsRepository(client),
    teams: new SupabaseTeamsRepository(client),
    fixtures: new SupabaseFixturesRepository(client),
    matchResults: new SupabaseMatchResultsRepository(client),
    matchEvents: new SupabaseMatchEventsRepository(client),
    teamObservations: new SupabaseTeamObservationsRepository(client),
    oddsObservations: new SupabaseOddsObservationsRepository(client),
    ingestionRuns: new SupabaseIngestionRunsRepository(client),
    quarantine: new SupabaseQuarantineRepository(client),
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export type ProviderFetchResult = { readonly ok: true; readonly records: readonly RawRecord[] } | { readonly ok: false; readonly failure: JobHandlerResult };

/**
 * Bounded retry (provider.ts's `withBoundedRetries` — never unbounded)
 * plus a uniform mapping of every `ProviderFetchOutcome` failure mode
 * ("Provider unavailable: do not fabricate data", rate-limited, or a
 * thrown transport error exceeding retries) into one `JobHandlerResult`
 * shape every football job handler shares — INTEGRATION_UNAVAILABLE is
 * retryable (see `isRetryableJobFailure`), so a transient provider
 * outage is retried by the job system itself, bounded by the job's own
 * `maxAttempts`, never a second, independent retry loop.
 */
export async function fetchProviderRecordsWithRetries(fetchFn: () => Promise<ProviderFetchOutcome<RawRecord>>, maxRetries: number, providerLabel: string): Promise<ProviderFetchResult> {
  let outcome: ProviderFetchOutcome<RawRecord>;
  try {
    outcome = await withBoundedRetries(fetchFn, maxRetries);
  } catch (error) {
    return { ok: false, failure: { ok: false, category: JobFailureCategory.INTEGRATION_UNAVAILABLE, message: `${providerLabel} request failed: ${error instanceof Error ? error.message : String(error)}` } };
  }
  if (outcome.status === "rate_limited") {
    return {
      ok: false,
      failure: { ok: false, category: JobFailureCategory.INTEGRATION_UNAVAILABLE, message: `${providerLabel} rate-limited the request${outcome.retryAfterSeconds !== undefined ? ` (retry after ${outcome.retryAfterSeconds}s)` : ""}.` },
    };
  }
  if (outcome.status === "unavailable") {
    return { ok: false, failure: { ok: false, category: JobFailureCategory.INTEGRATION_UNAVAILABLE, message: `${providerLabel}: ${outcome.reason}` } };
  }
  return { ok: true, records: outcome.records };
}
