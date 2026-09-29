import { ValidationError, type Result, type UUID } from "@sport-os/shared";
import type { IngestionMode, IngestionRun } from "./canonical.js";
import type { NormalizedCompetition, NormalizedFixture, NormalizedMatchEvent, NormalizedMatchResult, NormalizedOddsObservation, NormalizedSeason, NormalizedTeam } from "./normalize.js";
import type { FixtureFetchParams, FootballDataProvider, ProviderFetchOutcome, RawRecord } from "./provider.js";
import { withBoundedRetries } from "./provider.js";
import { checkBatchUniqueness, checkFixtureQuality, checkMatchEventQuality, checkMatchResultQuality, checkOddsObservationQuality, type QualityCheckContext } from "./quality-engine.js";
import type { IngestionRunsRepository } from "./repositories/ingestion-runs.js";
import type { FixturesRepository, MatchEventsRepository, MatchResultsRepository } from "./repositories/fixtures.js";
import type { OddsObservationsRepository, TeamObservationsRepository } from "./repositories/observations.js";
import type { CompetitionsRepository, SeasonsRepository, TeamsRepository } from "./repositories/reference-data.js";
import type { QuarantineRepository } from "./repositories/quality.js";

/**
 * Ingestion orchestration (Section 04 — RAW INGEST → NORMALIZATION →
 * DATA VALIDATION → QUALITY ENGINE → TIME-AWARE DATA STORE). This file
 * is the one place raw provider records are turned into rows.
 *
 * Deliberately provider-agnostic: every function here takes the raw
 * records and the matching normalizer(s) as parameters rather than
 * importing a specific adapter — see adapters/test-fixture-provider.ts
 * for the one concrete provider wired up this section, and
 * docs/architecture/FOOTBALL_DATA_ARCHITECTURE.md for how a second
 * provider would plug into these same functions.
 *
 * Every rejected record is quarantined with its reason and raw payload —
 * "never silently discard" — and every run's counts are written to an
 * IngestionRun row, satisfying "all critical ingestion operations must
 * be auditable".
 */

export interface IngestionDependencies {
  readonly competitions: CompetitionsRepository;
  readonly seasons: SeasonsRepository;
  readonly teams: TeamsRepository;
  readonly fixtures: FixturesRepository;
  readonly matchResults: MatchResultsRepository;
  readonly matchEvents: MatchEventsRepository;
  readonly teamObservations: TeamObservationsRepository;
  readonly oddsObservations: OddsObservationsRepository;
  readonly ingestionRuns: IngestionRunsRepository;
  readonly quarantine: QuarantineRepository;
}

function extractProviderRecordId(raw: RawRecord): string | undefined {
  return typeof raw.id === "string" ? raw.id : undefined;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ============================================================
// Reference data (competitions / seasons / teams) — safely upsertable,
// not subject to leakage protection. Fixtures below depend on these
// already having been ingested (a fixture referencing an unknown
// competition or team is quarantined, never inserted with a dangling
// reference).
// ============================================================

export interface ReferenceDataNormalizers {
  readonly normalizeCompetition: (raw: RawRecord) => Result<NormalizedCompetition, ValidationError>;
  readonly normalizeSeason: (raw: RawRecord) => Result<NormalizedSeason, ValidationError>;
  readonly normalizeTeam: (raw: RawRecord) => Result<NormalizedTeam, ValidationError>;
}

export interface ReferenceDataIngestResult {
  readonly competitionsUpserted: number;
  readonly seasonsUpserted: number;
  readonly teamsUpserted: number;
  readonly rejected: number;
}

export async function ingestReferenceData(
  deps: Pick<IngestionDependencies, "competitions" | "seasons" | "teams" | "quarantine">,
  provider: string,
  rawData: { readonly competitions: readonly RawRecord[]; readonly seasons: readonly RawRecord[]; readonly teams: readonly RawRecord[] },
  normalizers: ReferenceDataNormalizers,
  ingestionRunId: UUID | undefined,
): Promise<ReferenceDataIngestResult> {
  let competitionsUpserted = 0;
  let seasonsUpserted = 0;
  let teamsUpserted = 0;
  let rejected = 0;

  for (const raw of rawData.competitions) {
    const normalized = normalizers.normalizeCompetition(raw);
    if (!normalized.ok) {
      await deps.quarantine.quarantine({ provider, providerRecordId: extractProviderRecordId(raw), entityType: "competition", reason: normalized.error.message, rawPayload: raw, ingestionRunId });
      rejected++;
      continue;
    }
    await deps.competitions.upsert(normalized.value);
    competitionsUpserted++;
  }

  for (const raw of rawData.seasons) {
    const normalized = normalizers.normalizeSeason(raw);
    if (!normalized.ok) {
      await deps.quarantine.quarantine({ provider, providerRecordId: extractProviderRecordId(raw), entityType: "season", reason: normalized.error.message, rawPayload: raw, ingestionRunId });
      rejected++;
      continue;
    }
    const competition = await deps.competitions.getByProviderIdentity(provider, normalized.value.providerCompetitionId);
    if (!competition) {
      await deps.quarantine.quarantine({ provider, providerRecordId: normalized.value.providerSeasonId, entityType: "season", reason: "Referenced competition has not been ingested.", rawPayload: raw, ingestionRunId });
      rejected++;
      continue;
    }
    await deps.seasons.upsert(normalized.value, competition.id);
    seasonsUpserted++;
  }

  for (const raw of rawData.teams) {
    const normalized = normalizers.normalizeTeam(raw);
    if (!normalized.ok) {
      await deps.quarantine.quarantine({ provider, providerRecordId: extractProviderRecordId(raw), entityType: "team", reason: normalized.error.message, rawPayload: raw, ingestionRunId });
      rejected++;
      continue;
    }
    await deps.teams.upsert(normalized.value);
    teamsUpserted++;
  }

  return { competitionsUpserted, seasonsUpserted, teamsUpserted, rejected };
}

// ============================================================
// Fixtures — the one entity fetched through the provider abstraction
// (FootballFixtureProvider) in this section, since it is the only facet
// adapters/test-fixture-provider.ts wires up.
// ============================================================

export async function ingestFixtures(
  deps: IngestionDependencies,
  dataProvider: FootballDataProvider,
  normalizeFixture: (raw: RawRecord) => Result<NormalizedFixture, ValidationError>,
  mode: IngestionMode,
  params: FixtureFetchParams = {},
): Promise<IngestionRun> {
  const fixturesProvider = dataProvider.fixtures;
  if (!fixturesProvider) {
    throw new ValidationError({ message: "Provider does not support fixture ingestion.", code: "PROVIDER_MISSING_FIXTURES_FACET", context: { provider: dataProvider.provider } });
  }

  const run = await deps.ingestionRuns.start({ provider: dataProvider.provider, mode });
  const ctx: QualityCheckContext = { now: nowIso() };

  let outcome: ProviderFetchOutcome<RawRecord>;
  try {
    outcome = await withBoundedRetries(() => fixturesProvider.fetchFixtures(params), dataProvider.config.maxRetries);
  } catch (error) {
    return deps.ingestionRuns.update(run.id, {
      status: "failed",
      completedAt: nowIso(),
      errorCount: 1,
      metadata: { reason: error instanceof Error ? error.message : "Unknown transport error." },
    });
  }

  if (outcome.status !== "ok") {
    // "Provider unavailable: do not fabricate data" — a failed/rate-limited
    // outcome is recorded as a failed run, never silently treated as "zero
    // fixtures received".
    return deps.ingestionRuns.update(run.id, {
      status: "failed",
      completedAt: nowIso(),
      errorCount: 1,
      metadata: outcome.status === "unavailable" ? { reason: outcome.reason } : { reason: "rate_limited", retryAfterSeconds: outcome.retryAfterSeconds ?? null },
    });
  }

  const uniqueness = checkBatchUniqueness(outcome.records, extractProviderRecordId, "fixture");

  let inserted = 0;
  let updated = 0;
  let rejected = 0;

  for (const raw of outcome.records) {
    const normalized = normalizeFixture(raw);
    if (!normalized.ok) {
      await deps.quarantine.quarantine({ provider: dataProvider.provider, providerRecordId: extractProviderRecordId(raw), entityType: "fixture", reason: normalized.error.message, rawPayload: raw, ingestionRunId: run.id });
      rejected++;
      continue;
    }

    const quality = checkFixtureQuality(normalized.value, ctx);
    if (quality.status === "invalid") {
      await deps.quarantine.quarantine({
        provider: dataProvider.provider,
        providerRecordId: normalized.value.providerFixtureId,
        entityType: "fixture",
        reason: quality.errors.join("; "),
        rawPayload: raw,
        ingestionRunId: run.id,
      });
      rejected++;
      continue;
    }

    const competition = await deps.competitions.getByProviderIdentity(dataProvider.provider, normalized.value.providerCompetitionId);
    if (!competition) {
      await deps.quarantine.quarantine({
        provider: dataProvider.provider,
        providerRecordId: normalized.value.providerFixtureId,
        entityType: "fixture",
        reason: "Referenced competition has not been ingested.",
        rawPayload: raw,
        ingestionRunId: run.id,
      });
      rejected++;
      continue;
    }

    const homeTeam = await deps.teams.getByProviderIdentity(dataProvider.provider, normalized.value.providerHomeTeamId);
    const awayTeam = await deps.teams.getByProviderIdentity(dataProvider.provider, normalized.value.providerAwayTeamId);
    if (!homeTeam || !awayTeam) {
      await deps.quarantine.quarantine({
        provider: dataProvider.provider,
        providerRecordId: normalized.value.providerFixtureId,
        entityType: "fixture",
        reason: "Referenced home or away team has not been ingested.",
        rawPayload: raw,
        ingestionRunId: run.id,
      });
      rejected++;
      continue;
    }

    let seasonId: UUID | undefined;
    if (normalized.value.providerSeasonId !== undefined) {
      const season = await deps.seasons.getByProviderIdentity(dataProvider.provider, normalized.value.providerSeasonId);
      seasonId = season?.id;
    }

    const existing = await deps.fixtures.getByProviderIdentity(dataProvider.provider, normalized.value.providerFixtureId);

    // Fixture identity immutability (PR review fix — item 3): competition/
    // season/home team/away team are the fixture's identity, not its
    // "current state" — a repeat sighting reporting a DIFFERENT identity
    // than what's already on file is not a legitimate update (unlike
    // status, which is expected to change over a fixture's lifecycle). The
    // repository layer already refuses to rewrite these fields on a
    // repeat upsert (see repositories/fixtures.ts), but that alone would
    // silently ignore the disagreement; quarantining it here instead
    // surfaces the anomaly the same way an unknown competition/team
    // reference already is, rather than leaving a silent contradiction
    // between what the provider just reported and what's stored.
    if (existing && (existing.competitionId !== competition.id || existing.seasonId !== seasonId || existing.homeTeamId !== homeTeam.id || existing.awayTeamId !== awayTeam.id)) {
      await deps.quarantine.quarantine({
        provider: dataProvider.provider,
        providerRecordId: normalized.value.providerFixtureId,
        entityType: "fixture",
        reason: "Fixture identity (competition/season/home team/away team) is immutable once set; this sighting reports a different identity than the fixture already on file.",
        rawPayload: raw,
        ingestionRunId: run.id,
      });
      rejected++;
      continue;
    }

    await deps.fixtures.upsert({
      competitionId: competition.id,
      seasonId,
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      scheduledKickoffAt: normalized.value.scheduledKickoffAt,
      status: normalized.value.status,
      providerStatusRaw: normalized.value.providerStatusRaw,
      provider: dataProvider.provider,
      providerFixtureId: normalized.value.providerFixtureId,
    });
    if (existing) updated++;
    else inserted++;
  }

  return deps.ingestionRuns.update(run.id, {
    status: rejected > 0 ? "partial" : "completed",
    completedAt: nowIso(),
    recordsReceived: outcome.records.length,
    recordsInserted: inserted,
    recordsUpdated: updated,
    recordsRejected: rejected,
    errorCount: 0,
    metadata: { duplicateWarnings: uniqueness.warnings },
  });
}

// ============================================================
// Match results / events / odds. No FootballResultProvider/etc. facet is
// defined (Section 04 only names FootballFixtureProvider/TeamProvider/
// EventProvider/OddsProvider/PlayerProvider) and
// adapters/test-fixture-provider.ts does not wire fetchEvents/fetchOdds
// (no live provider exists to fetch from — see provider.ts). These
// functions therefore take raw records directly, the same shape a real
// adapter's `FootballEventProvider.fetchEvents`/`FootballOddsProvider.
// fetchOdds` call would return — a real integration plugs its provider's
// fetch call in ahead of these, unchanged.
// ============================================================

export async function ingestMatchResults(
  deps: IngestionDependencies,
  provider: string,
  mode: IngestionMode,
  rawResults: readonly RawRecord[],
  normalizeMatchResult: (raw: RawRecord) => Result<NormalizedMatchResult, ValidationError>,
): Promise<IngestionRun> {
  const run = await deps.ingestionRuns.start({ provider, mode });
  const ctx: QualityCheckContext = { now: nowIso() };
  const uniqueness = checkBatchUniqueness(rawResults, (raw) => (typeof raw.fixture_id === "string" ? raw.fixture_id : undefined), "match result");

  let inserted = 0;
  let updated = 0;
  let rejected = 0;

  for (const raw of rawResults) {
    const normalized = normalizeMatchResult(raw);
    if (!normalized.ok) {
      await deps.quarantine.quarantine({ provider, providerRecordId: extractProviderRecordId(raw), entityType: "match_result", reason: normalized.error.message, rawPayload: raw, ingestionRunId: run.id });
      rejected++;
      continue;
    }

    const fixture = await deps.fixtures.getByProviderIdentity(provider, normalized.value.providerFixtureId);
    if (!fixture) {
      await deps.quarantine.quarantine({
        provider,
        providerRecordId: normalized.value.providerFixtureId,
        entityType: "match_result",
        reason: "Referenced fixture has not been ingested.",
        rawPayload: raw,
        ingestionRunId: run.id,
      });
      rejected++;
      continue;
    }

    const quality = checkMatchResultQuality(normalized.value, fixture, ctx);
    if (quality.status === "invalid") {
      await deps.quarantine.quarantine({ provider, providerRecordId: normalized.value.providerFixtureId, entityType: "match_result", reason: quality.errors.join("; "), rawPayload: raw, ingestionRunId: run.id });
      rejected++;
      continue;
    }

    const existing = await deps.matchResults.getLatest(fixture.id);
    await deps.matchResults.insert({
      fixtureId: fixture.id,
      homeGoals: normalized.value.homeGoals,
      awayGoals: normalized.value.awayGoals,
      halftimeHomeGoals: normalized.value.halftimeHomeGoals,
      halftimeAwayGoals: normalized.value.halftimeAwayGoals,
      resultRecordedAt: normalized.value.resultRecordedAt,
      source: normalized.value.source,
    });
    if (existing) updated++;
    else inserted++;
  }

  return deps.ingestionRuns.update(run.id, {
    status: rejected > 0 ? "partial" : "completed",
    completedAt: nowIso(),
    recordsReceived: rawResults.length,
    recordsInserted: inserted,
    recordsUpdated: updated,
    recordsRejected: rejected,
    errorCount: 0,
    metadata: { duplicateWarnings: uniqueness.warnings },
  });
}

export async function ingestMatchEvents(
  deps: IngestionDependencies,
  provider: string,
  mode: IngestionMode,
  rawEvents: readonly RawRecord[],
  normalizeMatchEvent: (raw: RawRecord) => Result<NormalizedMatchEvent, ValidationError>,
): Promise<IngestionRun> {
  const run = await deps.ingestionRuns.start({ provider, mode });
  const ctx: QualityCheckContext = { now: nowIso() };
  const uniqueness = checkBatchUniqueness(rawEvents, extractProviderRecordId, "match event");

  let inserted = 0;
  let rejected = 0;

  for (const raw of rawEvents) {
    const normalized = normalizeMatchEvent(raw);
    if (!normalized.ok) {
      await deps.quarantine.quarantine({ provider, providerRecordId: extractProviderRecordId(raw), entityType: "match_event", reason: normalized.error.message, rawPayload: raw, ingestionRunId: run.id });
      rejected++;
      continue;
    }

    const fixture = await deps.fixtures.getByProviderIdentity(provider, normalized.value.providerFixtureId);
    if (!fixture) {
      await deps.quarantine.quarantine({
        provider,
        providerRecordId: normalized.value.providerFixtureId,
        entityType: "match_event",
        reason: "Referenced fixture has not been ingested.",
        rawPayload: raw,
        ingestionRunId: run.id,
      });
      rejected++;
      continue;
    }

    const quality = checkMatchEventQuality(normalized.value, fixture, ctx);
    if (quality.status === "invalid") {
      await deps.quarantine.quarantine({
        provider,
        providerRecordId: normalized.value.providerEventId ?? normalized.value.providerFixtureId,
        entityType: "match_event",
        reason: quality.errors.join("; "),
        rawPayload: raw,
        ingestionRunId: run.id,
      });
      rejected++;
      continue;
    }

    let teamId: UUID | undefined;
    if (normalized.value.providerTeamId !== undefined) {
      const team = await deps.teams.getByProviderIdentity(provider, normalized.value.providerTeamId);
      teamId = team?.id;
    }

    await deps.matchEvents.insert({
      fixtureId: fixture.id,
      eventType: normalized.value.eventType,
      providerEventType: normalized.value.providerEventType,
      teamId,
      minute: normalized.value.minute,
      observedAt: normalized.value.observedAt,
      provider,
      providerEventId: normalized.value.providerEventId,
    });
    inserted++;
  }

  return deps.ingestionRuns.update(run.id, {
    status: rejected > 0 ? "partial" : "completed",
    completedAt: nowIso(),
    recordsReceived: rawEvents.length,
    recordsInserted: inserted,
    recordsUpdated: 0,
    recordsRejected: rejected,
    errorCount: 0,
    metadata: { duplicateWarnings: uniqueness.warnings },
  });
}

export async function ingestOddsObservations(
  deps: IngestionDependencies,
  provider: string,
  mode: IngestionMode,
  rawOdds: readonly RawRecord[],
  normalizeOdds: (raw: RawRecord) => Result<NormalizedOddsObservation, ValidationError>,
): Promise<IngestionRun> {
  const run = await deps.ingestionRuns.start({ provider, mode });
  const ctx: QualityCheckContext = { now: nowIso() };
  // Deliberately no batch uniqueness check against providerObservationId:
  // multiple odds observations for the same fixture/market/selection are
  // the norm, not a duplicate — "never just latest" (see canonical.ts's
  // OddsObservation and repositories/observations.ts).

  let inserted = 0;
  let rejected = 0;

  for (const raw of rawOdds) {
    const normalized = normalizeOdds(raw);
    if (!normalized.ok) {
      await deps.quarantine.quarantine({ provider, providerRecordId: extractProviderRecordId(raw), entityType: "odds_observation", reason: normalized.error.message, rawPayload: raw, ingestionRunId: run.id });
      rejected++;
      continue;
    }

    const fixture = await deps.fixtures.getByProviderIdentity(provider, normalized.value.providerFixtureId);
    if (!fixture) {
      await deps.quarantine.quarantine({
        provider,
        providerRecordId: normalized.value.providerFixtureId,
        entityType: "odds_observation",
        reason: "Referenced fixture has not been ingested.",
        rawPayload: raw,
        ingestionRunId: run.id,
      });
      rejected++;
      continue;
    }

    const quality = checkOddsObservationQuality(normalized.value, fixture, ctx);
    if (quality.status === "invalid") {
      await deps.quarantine.quarantine({ provider, providerRecordId: normalized.value.providerFixtureId, entityType: "odds_observation", reason: quality.errors.join("; "), rawPayload: raw, ingestionRunId: run.id });
      rejected++;
      continue;
    }

    await deps.oddsObservations.insert({
      fixtureId: fixture.id,
      marketType: normalized.value.marketType,
      selection: normalized.value.selection,
      odds: normalized.value.odds,
      bookmakerSource: normalized.value.bookmakerSource,
      observedAt: normalized.value.observedAt,
      providerPublishedAt: normalized.value.providerPublishedAt,
      temporalReliability: normalized.value.temporalReliability,
      provider,
      providerObservationId: normalized.value.providerObservationId,
      ingestionRunId: run.id,
    });
    inserted++;
  }

  return deps.ingestionRuns.update(run.id, {
    status: rejected > 0 ? "partial" : "completed",
    completedAt: nowIso(),
    recordsReceived: rawOdds.length,
    recordsInserted: inserted,
    recordsUpdated: 0,
    recordsRejected: rejected,
    errorCount: 0,
  });
}
