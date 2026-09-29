import { generateId, ValidationError, type UUID } from "@sport-os/shared";
import type { SupabaseClient } from "@sport-os/platform";
import type { OddsObservation, TeamObservation, TemporalReliability } from "../canonical.js";
import type { OddsObservationRow, TeamObservationRow } from "../db/types.js";

/**
 * Observation repositories (Section 04 — Team Performance Snapshots /
 * Odds Data / Point-In-Time Query Contract). Append-only: `insert`, no
 * `update` — a correction is a new observation with a later
 * `observedAt`, never a mutation of an existing row (see the tables'
 * own migration comments). The `*AsOf` methods are the core primitive
 * LeakageGuard and, later, Section 05's feature engineering build on.
 */

export interface NewTeamObservationInput {
  readonly teamId: UUID;
  readonly fixtureId: UUID | undefined;
  readonly competitionId: UUID | undefined;
  readonly observationType: string;
  readonly metrics: Readonly<Record<string, number | string | boolean | null>>;
  readonly observedAt: string;
  readonly providerPublishedAt: string | undefined;
  readonly sourceUpdatedAt: string | undefined;
  readonly provider: string;
  readonly providerObservationId: string | undefined;
  readonly ingestionRunId: UUID | undefined;
}

export interface TeamObservationsRepository {
  insert(input: NewTeamObservationInput): Promise<TeamObservation>;
  /** Only observations with observedAt <= asOf — the point-in-time-safe read. */
  listForTeamAsOf(teamId: UUID, asOf: string): Promise<readonly TeamObservation[]>;
}

export interface NewOddsObservationInput {
  readonly fixtureId: UUID;
  readonly marketType: string;
  readonly selection: string;
  readonly odds: number;
  readonly bookmakerSource: string;
  readonly observedAt: string;
  readonly providerPublishedAt: string | undefined;
  readonly temporalReliability: TemporalReliability;
  readonly provider: string;
  readonly providerObservationId: string | undefined;
  readonly ingestionRunId: UUID | undefined;
}

export interface OddsObservationsRepository {
  insert(input: NewOddsObservationInput): Promise<OddsObservation>;
  listForFixture(fixtureId: UUID): Promise<readonly OddsObservation[]>;
  /** Only observations with observedAt <= asOf — never treats a current odds value as historical (see "Odds Timestamp Rule"). */
  listForFixtureAsOf(fixtureId: UUID, asOf: string): Promise<readonly OddsObservation[]>;
}

function teamObservationRowToDomain(row: TeamObservationRow): TeamObservation {
  return {
    id: row.id,
    teamId: row.team_id,
    fixtureId: row.fixture_id ?? undefined,
    competitionId: row.competition_id ?? undefined,
    observationType: row.observation_type,
    metrics: row.metrics as Record<string, number | string | boolean | null>,
    observedAt: row.observed_at,
    providerPublishedAt: row.provider_published_at ?? undefined,
    sourceUpdatedAt: row.source_updated_at ?? undefined,
    provider: row.provider,
    providerObservationId: row.provider_observation_id ?? undefined,
    ingestionRunId: row.ingestion_run_id ?? undefined,
  };
}

function oddsObservationRowToDomain(row: OddsObservationRow): OddsObservation {
  return {
    id: row.id,
    fixtureId: row.fixture_id,
    marketType: row.market_type,
    selection: row.selection,
    odds: row.odds,
    bookmakerSource: row.bookmaker_source,
    observedAt: row.observed_at,
    providerPublishedAt: row.provider_published_at ?? undefined,
    temporalReliability: row.temporal_reliability,
    provider: row.provider,
    providerObservationId: row.provider_observation_id ?? undefined,
    ingestionRunId: row.ingestion_run_id ?? undefined,
  };
}

// ============================================================
// In-memory implementations
// ============================================================

export class InMemoryTeamObservationsRepository implements TeamObservationsRepository {
  private readonly observations: TeamObservation[] = [];

  async insert(input: NewTeamObservationInput): Promise<TeamObservation> {
    const observation: TeamObservation = { id: generateId(), ...input };
    this.observations.push(observation);
    return observation;
  }

  async listForTeamAsOf(teamId: UUID, asOf: string): Promise<readonly TeamObservation[]> {
    const asOfMs = new Date(asOf).getTime();
    return this.observations.filter((o) => o.teamId === teamId && new Date(o.observedAt).getTime() <= asOfMs);
  }
}

export class InMemoryOddsObservationsRepository implements OddsObservationsRepository {
  private readonly observations: OddsObservation[] = [];

  async insert(input: NewOddsObservationInput): Promise<OddsObservation> {
    if (input.odds <= 0) {
      throw new ValidationError({ message: "Odds must be positive.", code: "ODDS_INVALID" });
    }
    const observation: OddsObservation = { id: generateId(), ...input };
    this.observations.push(observation);
    return observation;
  }

  async listForFixture(fixtureId: UUID): Promise<readonly OddsObservation[]> {
    return this.observations.filter((o) => o.fixtureId === fixtureId);
  }

  async listForFixtureAsOf(fixtureId: UUID, asOf: string): Promise<readonly OddsObservation[]> {
    const asOfMs = new Date(asOf).getTime();
    return this.observations.filter((o) => o.fixtureId === fixtureId && new Date(o.observedAt).getTime() <= asOfMs);
  }
}

// ============================================================
// Supabase-backed implementations
// ============================================================

export class SupabaseTeamObservationsRepository implements TeamObservationsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async insert(input: NewTeamObservationInput): Promise<TeamObservation> {
    const { data, error } = await this.client
      .from("team_observations")
      .insert({
        team_id: input.teamId,
        fixture_id: input.fixtureId ?? null,
        competition_id: input.competitionId ?? null,
        observation_type: input.observationType,
        metrics: input.metrics,
        observed_at: input.observedAt,
        provider_published_at: input.providerPublishedAt ?? null,
        source_updated_at: input.sourceUpdatedAt ?? null,
        provider: input.provider,
        provider_observation_id: input.providerObservationId ?? null,
        ingestion_run_id: input.ingestionRunId ?? null,
      })
      .select("*")
      .single();
    if (error || !data) {
      throw new ValidationError({ message: "Failed to insert team observation.", code: "TEAM_OBSERVATION_INSERT_FAILED", context: { reason: error?.message } });
    }
    return teamObservationRowToDomain(data as TeamObservationRow);
  }

  async listForTeamAsOf(teamId: UUID, asOf: string): Promise<readonly TeamObservation[]> {
    const { data, error } = await this.client.from("team_observations").select("*").eq("team_id", teamId).lte("observed_at", asOf).order("observed_at", { ascending: true });
    if (error || !data) return [];
    return (data as readonly TeamObservationRow[]).map(teamObservationRowToDomain);
  }
}

export class SupabaseOddsObservationsRepository implements OddsObservationsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async insert(input: NewOddsObservationInput): Promise<OddsObservation> {
    const { data, error } = await this.client
      .from("odds_observations")
      .insert({
        fixture_id: input.fixtureId,
        market_type: input.marketType,
        selection: input.selection,
        odds: input.odds,
        bookmaker_source: input.bookmakerSource,
        observed_at: input.observedAt,
        provider_published_at: input.providerPublishedAt ?? null,
        temporal_reliability: input.temporalReliability,
        provider: input.provider,
        provider_observation_id: input.providerObservationId ?? null,
        ingestion_run_id: input.ingestionRunId ?? null,
      })
      .select("*")
      .single();
    if (error || !data) {
      throw new ValidationError({ message: "Failed to insert odds observation.", code: "ODDS_OBSERVATION_INSERT_FAILED", context: { reason: error?.message } });
    }
    return oddsObservationRowToDomain(data as OddsObservationRow);
  }

  async listForFixture(fixtureId: UUID): Promise<readonly OddsObservation[]> {
    const { data, error } = await this.client.from("odds_observations").select("*").eq("fixture_id", fixtureId).order("observed_at", { ascending: true });
    if (error || !data) return [];
    return (data as readonly OddsObservationRow[]).map(oddsObservationRowToDomain);
  }

  async listForFixtureAsOf(fixtureId: UUID, asOf: string): Promise<readonly OddsObservation[]> {
    const { data, error } = await this.client.from("odds_observations").select("*").eq("fixture_id", fixtureId).lte("observed_at", asOf).order("observed_at", { ascending: true });
    if (error || !data) return [];
    return (data as readonly OddsObservationRow[]).map(oddsObservationRowToDomain);
  }
}
