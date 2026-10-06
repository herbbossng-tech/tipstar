import {
  buildSportmonksProvider,
  ingestReferenceData,
  normalizeSportmonksCompetition,
  normalizeSportmonksSeason,
  normalizeSportmonksTeam,
  SPORTMONKS_PROVIDER_NAME,
  type IngestionDependencies,
  type ProviderConfig,
  type RawRecord,
} from "@sport-os/football-engine";
import { fetchSportmonksCompetitions, fetchSportmonksSeasons } from "@sport-os/football-engine";
import { OperationalJobType, type OperationalJobRecord } from "@sport-os/platform";
import type { JobHandler, JobHandlerResult } from "../worker.js";
import { fetchProviderRecordsWithRetries } from "./shared.js";

/**
 * FOOTBALL_REFERENCE_INGESTION (Section 13). Ingests Sportmonks
 * competitions/seasons/teams for the configured league ids ONLY —
 * fixtures/results/events are FOOTBALL_FIXTURE_INGESTION's job, odds are
 * FOOTBALL_ODDS_INGESTION's (see those files). Reuses
 * `ingestReferenceData` from `ingestion.ts` completely unchanged.
 *
 * `leagueProviderIds` is supplied by the caller (apps/worker's
 * container, sourced from `config.providers.football.selectedIds` —
 * `FOOTBALL_DATA_COMPETITION_IDS`) — this class never hard-codes a
 * league list itself. An empty list, or `footballConfig.enabled ===
 * false`, safely no-ops (`{ ok: true }`), never an error — "never
 * generate uncontrolled API usage."
 */
export class FootballReferenceIngestionJobHandler implements JobHandler {
  readonly jobType: OperationalJobType = OperationalJobType.FOOTBALL_REFERENCE_INGESTION;

  constructor(
    private readonly deps: IngestionDependencies,
    private readonly footballConfig: ProviderConfig,
    private readonly leagueProviderIds: readonly string[],
    /** Injectable for testing — defaults to the global fetch, same pattern as TelegramBotApiService/the adapters themselves. */
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async handle(_job: OperationalJobRecord): Promise<JobHandlerResult> {
    if (!this.footballConfig.enabled || this.leagueProviderIds.length === 0) {
      return { ok: true };
    }

    const deps = this.deps;
    const provider = buildSportmonksProvider(this.footballConfig, this.fetchImpl);

    const competitions = await fetchProviderRecordsWithRetries(() => fetchSportmonksCompetitions(this.footballConfig, this.leagueProviderIds, this.fetchImpl), this.footballConfig.maxRetries, "Sportmonks competitions fetch");
    if (!competitions.ok) return competitions.failure;

    const seasons = await fetchProviderRecordsWithRetries(() => fetchSportmonksSeasons(this.footballConfig, this.leagueProviderIds, this.fetchImpl), this.footballConfig.maxRetries, "Sportmonks seasons fetch");
    if (!seasons.ok) return seasons.failure;

    const teamRecords: RawRecord[] = [];
    for (const leagueId of this.leagueProviderIds) {
      const teams = await fetchProviderRecordsWithRetries(() => provider.teams!.fetchTeams({ competitionProviderId: leagueId }), this.footballConfig.maxRetries, `Sportmonks teams fetch (league ${leagueId})`);
      if (!teams.ok) return teams.failure;
      teamRecords.push(...teams.records);
    }

    await ingestReferenceData(
      deps,
      SPORTMONKS_PROVIDER_NAME,
      { competitions: competitions.records, seasons: seasons.records, teams: teamRecords },
      { normalizeCompetition: normalizeSportmonksCompetition, normalizeSeason: normalizeSportmonksSeason, normalizeTeam: normalizeSportmonksTeam },
      undefined,
    );

    // A non-zero `rejected` count inside ingestReferenceData is NOT a job
    // failure — every rejected record is already quarantined by the
    // quality engine itself (public.data_quarantine); this job only
    // fails on a genuine fetch/transport failure, handled above.
    return { ok: true };
  }
}
