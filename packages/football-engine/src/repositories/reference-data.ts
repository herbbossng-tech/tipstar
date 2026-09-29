import { generateId, ValidationError, type UUID } from "@sport-os/shared";
import type { SupabaseClient } from "@sport-os/platform";
import type { Competition, Season, Team, Venue } from "../canonical.js";
import type { CompetitionRow, SeasonRow, TeamRow, VenueRow } from "../db/types.js";
import type { NormalizedCompetition, NormalizedSeason, NormalizedTeam } from "../normalize.js";

/**
 * Reference-data repositories (Section 04 — Upsert Rules: "Safe mutable
 * entities may be updated: team metadata, competition metadata, fixture
 * status, venue metadata"). Unlike observations (append-only), these are
 * genuinely upserted by (provider, providerId) — a provider correcting a
 * team's name is expected and safe to apply in place.
 */

export interface CompetitionsRepository {
  upsert(input: NormalizedCompetition): Promise<Competition>;
  getById(id: UUID): Promise<Competition | undefined>;
  getByProviderIdentity(provider: string, providerCompetitionId: string): Promise<Competition | undefined>;
}

export interface SeasonsRepository {
  upsert(input: NormalizedSeason, competitionId: UUID): Promise<Season>;
  getByProviderIdentity(provider: string, providerSeasonId: string): Promise<Season | undefined>;
}

export interface TeamsRepository {
  upsert(input: NormalizedTeam): Promise<Team>;
  getById(id: UUID): Promise<Team | undefined>;
  getByProviderIdentity(provider: string, providerTeamId: string): Promise<Team | undefined>;
}

export interface VenuesRepository {
  upsertByProviderIdentity(provider: string, providerVenueId: string, name: string, city: string | undefined, country: string | undefined): Promise<Venue>;
}

function competitionRowToDomain(row: CompetitionRow): Competition {
  return {
    id: row.id,
    provider: row.provider,
    providerCompetitionId: row.provider_competition_id,
    name: row.name,
    country: row.country ?? undefined,
    competitionType: row.competition_type ?? undefined,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function seasonRowToDomain(row: SeasonRow): Season {
  return {
    id: row.id,
    competitionId: row.competition_id,
    provider: row.provider,
    providerSeasonId: row.provider_season_id,
    name: row.name,
    startDate: row.start_date ?? undefined,
    endDate: row.end_date ?? undefined,
    status: row.status ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function teamRowToDomain(row: TeamRow): Team {
  return {
    id: row.id,
    provider: row.provider,
    providerTeamId: row.provider_team_id,
    name: row.name,
    shortName: row.short_name ?? undefined,
    country: row.country ?? undefined,
    venueId: row.venue_id ?? undefined,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function venueRowToDomain(row: VenueRow): Venue {
  return { id: row.id, provider: row.provider ?? undefined, providerVenueId: row.provider_venue_id ?? undefined, name: row.name, city: row.city ?? undefined, country: row.country ?? undefined };
}

// ============================================================
// In-memory implementations (fast unit tests — no network, no PostgREST)
// ============================================================

export class InMemoryCompetitionsRepository implements CompetitionsRepository {
  private readonly byId = new Map<UUID, Competition>();

  async upsert(input: NormalizedCompetition): Promise<Competition> {
    const existing = await this.getByProviderIdentity(input.provider, input.providerCompetitionId);
    const now = new Date().toISOString();
    const competition: Competition = {
      id: existing?.id ?? generateId(),
      provider: input.provider,
      providerCompetitionId: input.providerCompetitionId,
      name: input.name,
      country: input.country,
      competitionType: input.competitionType,
      active: input.active,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.byId.set(competition.id, competition);
    return competition;
  }

  async getById(id: UUID): Promise<Competition | undefined> {
    return this.byId.get(id);
  }

  async getByProviderIdentity(provider: string, providerCompetitionId: string): Promise<Competition | undefined> {
    for (const competition of this.byId.values()) {
      if (competition.provider === provider && competition.providerCompetitionId === providerCompetitionId) return competition;
    }
    return undefined;
  }
}

export class InMemorySeasonsRepository implements SeasonsRepository {
  private readonly byId = new Map<UUID, Season>();

  async upsert(input: NormalizedSeason, competitionId: UUID): Promise<Season> {
    const existing = await this.getByProviderIdentity(input.provider, input.providerSeasonId);
    const now = new Date().toISOString();
    const season: Season = {
      id: existing?.id ?? generateId(),
      competitionId,
      provider: input.provider,
      providerSeasonId: input.providerSeasonId,
      name: input.name,
      startDate: input.startDate,
      endDate: input.endDate,
      status: input.status,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.byId.set(season.id, season);
    return season;
  }

  async getByProviderIdentity(provider: string, providerSeasonId: string): Promise<Season | undefined> {
    for (const season of this.byId.values()) {
      if (season.provider === provider && season.providerSeasonId === providerSeasonId) return season;
    }
    return undefined;
  }
}

export class InMemoryTeamsRepository implements TeamsRepository {
  private readonly byId = new Map<UUID, Team>();

  async upsert(input: NormalizedTeam): Promise<Team> {
    const existing = await this.getByProviderIdentity(input.provider, input.providerTeamId);
    const now = new Date().toISOString();
    const team: Team = {
      id: existing?.id ?? generateId(),
      provider: input.provider,
      providerTeamId: input.providerTeamId,
      name: input.name,
      shortName: input.shortName,
      country: input.country,
      venueId: existing?.venueId,
      active: true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.byId.set(team.id, team);
    return team;
  }

  async getById(id: UUID): Promise<Team | undefined> {
    return this.byId.get(id);
  }

  async getByProviderIdentity(provider: string, providerTeamId: string): Promise<Team | undefined> {
    for (const team of this.byId.values()) {
      if (team.provider === provider && team.providerTeamId === providerTeamId) return team;
    }
    return undefined;
  }
}

export class InMemoryVenuesRepository implements VenuesRepository {
  private readonly byProviderIdentity = new Map<string, Venue>();

  async upsertByProviderIdentity(provider: string, providerVenueId: string, name: string, city: string | undefined, country: string | undefined): Promise<Venue> {
    const key = `${provider}:${providerVenueId}`;
    const existing = this.byProviderIdentity.get(key);
    const venue: Venue = { id: existing?.id ?? generateId(), provider, providerVenueId, name, city, country };
    this.byProviderIdentity.set(key, venue);
    return venue;
  }
}

// ============================================================
// Supabase-backed implementations
// ============================================================

export class SupabaseCompetitionsRepository implements CompetitionsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async upsert(input: NormalizedCompetition): Promise<Competition> {
    const { data, error } = await this.client
      .from("competitions")
      .upsert(
        { provider: input.provider, provider_competition_id: input.providerCompetitionId, name: input.name, country: input.country ?? null, competition_type: input.competitionType ?? null, active: input.active },
        { onConflict: "provider,provider_competition_id" },
      )
      .select("*")
      .single();
    if (error || !data) {
      throw new ValidationError({ message: "Failed to upsert competition.", code: "COMPETITION_UPSERT_FAILED", context: { reason: error?.message } });
    }
    return competitionRowToDomain(data as CompetitionRow);
  }

  async getById(id: UUID): Promise<Competition | undefined> {
    const { data, error } = await this.client.from("competitions").select("*").eq("id", id).maybeSingle();
    if (error || !data) return undefined;
    return competitionRowToDomain(data as CompetitionRow);
  }

  async getByProviderIdentity(provider: string, providerCompetitionId: string): Promise<Competition | undefined> {
    const { data, error } = await this.client.from("competitions").select("*").eq("provider", provider).eq("provider_competition_id", providerCompetitionId).maybeSingle();
    if (error || !data) return undefined;
    return competitionRowToDomain(data as CompetitionRow);
  }
}

export class SupabaseSeasonsRepository implements SeasonsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async upsert(input: NormalizedSeason, competitionId: UUID): Promise<Season> {
    const { data, error } = await this.client
      .from("seasons")
      .upsert(
        { competition_id: competitionId, provider: input.provider, provider_season_id: input.providerSeasonId, name: input.name, start_date: input.startDate ?? null, end_date: input.endDate ?? null, status: input.status ?? null },
        { onConflict: "provider,provider_season_id" },
      )
      .select("*")
      .single();
    if (error || !data) {
      throw new ValidationError({ message: "Failed to upsert season.", code: "SEASON_UPSERT_FAILED", context: { reason: error?.message } });
    }
    return seasonRowToDomain(data as SeasonRow);
  }

  async getByProviderIdentity(provider: string, providerSeasonId: string): Promise<Season | undefined> {
    const { data, error } = await this.client.from("seasons").select("*").eq("provider", provider).eq("provider_season_id", providerSeasonId).maybeSingle();
    if (error || !data) return undefined;
    return seasonRowToDomain(data as SeasonRow);
  }
}

export class SupabaseTeamsRepository implements TeamsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async upsert(input: NormalizedTeam): Promise<Team> {
    const { data, error } = await this.client
      .from("teams")
      .upsert(
        { provider: input.provider, provider_team_id: input.providerTeamId, name: input.name, short_name: input.shortName ?? null, country: input.country ?? null },
        { onConflict: "provider,provider_team_id" },
      )
      .select("*")
      .single();
    if (error || !data) {
      throw new ValidationError({ message: "Failed to upsert team.", code: "TEAM_UPSERT_FAILED", context: { reason: error?.message } });
    }
    return teamRowToDomain(data as TeamRow);
  }

  async getById(id: UUID): Promise<Team | undefined> {
    const { data, error } = await this.client.from("teams").select("*").eq("id", id).maybeSingle();
    if (error || !data) return undefined;
    return teamRowToDomain(data as TeamRow);
  }

  async getByProviderIdentity(provider: string, providerTeamId: string): Promise<Team | undefined> {
    const { data, error } = await this.client.from("teams").select("*").eq("provider", provider).eq("provider_team_id", providerTeamId).maybeSingle();
    if (error || !data) return undefined;
    return teamRowToDomain(data as TeamRow);
  }
}

export class SupabaseVenuesRepository implements VenuesRepository {
  constructor(private readonly client: SupabaseClient) {}

  async upsertByProviderIdentity(provider: string, providerVenueId: string, name: string, city: string | undefined, country: string | undefined): Promise<Venue> {
    const { data, error } = await this.client
      .from("venues")
      .upsert({ provider, provider_venue_id: providerVenueId, name, city: city ?? null, country: country ?? null }, { onConflict: "provider,provider_venue_id" })
      .select("*")
      .single();
    if (error || !data) {
      throw new ValidationError({ message: "Failed to upsert venue.", code: "VENUE_UPSERT_FAILED", context: { reason: error?.message } });
    }
    return venueRowToDomain(data as VenueRow);
  }
}
