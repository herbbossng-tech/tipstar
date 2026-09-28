import { generateId, ValidationError, type UUID } from "@sport-os/shared";
import type { SupabaseClient } from "@sport-os/platform";
import type { Fixture, MatchEvent, MatchResult, MatchStatus } from "../canonical.js";
import type { FixtureRow, MatchEventRow, MatchResultRow } from "../db/types.js";

/**
 * Fixture/MatchResult/MatchEvent repositories (Section 04 — Fixture /
 * Match Result / Match Events). Fixture status/venue are safely
 * upsertable (Upsert Rules); scheduledKickoffAt is set once at insert
 * and never overwritten on update — see FixturesRepository.upsert()'s
 * implementations. MatchEvents are append-only.
 */

export interface NewFixtureInput {
  readonly competitionId: UUID;
  readonly seasonId: UUID | undefined;
  readonly homeTeamId: UUID;
  readonly awayTeamId: UUID;
  readonly scheduledKickoffAt: string;
  readonly status: MatchStatus;
  readonly providerStatusRaw: string | undefined;
  readonly provider: string;
  readonly providerFixtureId: string;
}

export interface FixturesRepository {
  /** Inserts on first sight; on a repeat sighting, only status/providerStatusRaw/actualKickoffAt may change — scheduledKickoffAt is set once and never touched again. */
  upsert(input: NewFixtureInput): Promise<Fixture>;
  getById(id: UUID): Promise<Fixture | undefined>;
  getByProviderIdentity(provider: string, providerFixtureId: string): Promise<Fixture | undefined>;
}

export interface NewMatchResultInput {
  readonly fixtureId: UUID;
  readonly homeGoals: number;
  readonly awayGoals: number;
  readonly halftimeHomeGoals: number | undefined;
  readonly halftimeAwayGoals: number | undefined;
  readonly resultRecordedAt: string;
  readonly source: string;
}

export interface MatchResultsRepository {
  /** First write creates the row; a second write for the same fixture is treated as a provider correction (corrected_at/correction_count bumped), never silently overwritten. */
  upsert(input: NewMatchResultInput): Promise<MatchResult>;
  getByFixtureId(fixtureId: UUID): Promise<MatchResult | undefined>;
}

export interface NewMatchEventInput {
  readonly fixtureId: UUID;
  readonly eventType: MatchEvent["eventType"];
  readonly providerEventType: string | undefined;
  readonly teamId: UUID | undefined;
  readonly minute: number | undefined;
  readonly observedAt: string;
  readonly provider: string;
  readonly providerEventId: string | undefined;
}

export interface MatchEventsRepository {
  /** Append-only insert. Idempotent when providerEventId is present (see the DB's partial unique index) — a duplicate insert is a no-op, not a new row. */
  insert(input: NewMatchEventInput): Promise<MatchEvent>;
  listForFixture(fixtureId: UUID): Promise<readonly MatchEvent[]>;
  /** The point-in-time-safe read: only events observed at or before `asOf`. */
  listForFixtureAsOf(fixtureId: UUID, asOf: string): Promise<readonly MatchEvent[]>;
}

function fixtureRowToDomain(row: FixtureRow): Fixture {
  return {
    id: row.id,
    competitionId: row.competition_id,
    seasonId: row.season_id ?? undefined,
    homeTeamId: row.home_team_id,
    awayTeamId: row.away_team_id,
    scheduledKickoffAt: row.scheduled_kickoff_at,
    actualKickoffAt: row.actual_kickoff_at ?? undefined,
    status: row.status,
    providerStatusRaw: row.provider_status_raw ?? undefined,
    venueId: row.venue_id ?? undefined,
    provider: row.provider,
    providerFixtureId: row.provider_fixture_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function matchResultRowToDomain(row: MatchResultRow): MatchResult {
  return {
    id: row.id,
    fixtureId: row.fixture_id,
    homeGoals: row.home_goals,
    awayGoals: row.away_goals,
    halftimeHomeGoals: row.halftime_home_goals ?? undefined,
    halftimeAwayGoals: row.halftime_away_goals ?? undefined,
    resultRecordedAt: row.result_recorded_at,
    source: row.source,
    correctedAt: row.corrected_at ?? undefined,
    correctionCount: row.correction_count,
  };
}

function matchEventRowToDomain(row: MatchEventRow): MatchEvent {
  return {
    id: row.id,
    fixtureId: row.fixture_id,
    eventType: row.event_type,
    providerEventType: row.provider_event_type ?? undefined,
    teamId: row.team_id ?? undefined,
    minute: row.minute ?? undefined,
    observedAt: row.observed_at,
    provider: row.provider,
    providerEventId: row.provider_event_id ?? undefined,
  };
}

// ============================================================
// In-memory implementations
// ============================================================

export class InMemoryFixturesRepository implements FixturesRepository {
  private readonly byId = new Map<UUID, Fixture>();

  async upsert(input: NewFixtureInput): Promise<Fixture> {
    if (input.homeTeamId === input.awayTeamId) {
      throw new ValidationError({ message: "Fixture must have two distinct teams.", code: "FIXTURE_SAME_TEAM" });
    }
    const existing = await this.getByProviderIdentity(input.provider, input.providerFixtureId);
    const now = new Date().toISOString();
    const fixture: Fixture = {
      id: existing?.id ?? generateId(),
      competitionId: input.competitionId,
      seasonId: input.seasonId,
      homeTeamId: input.homeTeamId,
      awayTeamId: input.awayTeamId,
      // Set once — never overwritten by a later upsert, even if the
      // provider now reports a different kickoff time (a delay updates
      // actualKickoffAt, never this field).
      scheduledKickoffAt: existing?.scheduledKickoffAt ?? input.scheduledKickoffAt,
      actualKickoffAt: existing?.actualKickoffAt,
      status: input.status,
      providerStatusRaw: input.providerStatusRaw,
      venueId: existing?.venueId,
      provider: input.provider,
      providerFixtureId: input.providerFixtureId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.byId.set(fixture.id, fixture);
    return fixture;
  }

  async getById(id: UUID): Promise<Fixture | undefined> {
    return this.byId.get(id);
  }

  async getByProviderIdentity(provider: string, providerFixtureId: string): Promise<Fixture | undefined> {
    for (const fixture of this.byId.values()) {
      if (fixture.provider === provider && fixture.providerFixtureId === providerFixtureId) return fixture;
    }
    return undefined;
  }
}

export class InMemoryMatchResultsRepository implements MatchResultsRepository {
  private readonly byFixtureId = new Map<UUID, MatchResult>();

  async upsert(input: NewMatchResultInput): Promise<MatchResult> {
    const existing = this.byFixtureId.get(input.fixtureId);
    const result: MatchResult = {
      id: existing?.id ?? generateId(),
      fixtureId: input.fixtureId,
      homeGoals: input.homeGoals,
      awayGoals: input.awayGoals,
      halftimeHomeGoals: input.halftimeHomeGoals,
      halftimeAwayGoals: input.halftimeAwayGoals,
      resultRecordedAt: existing?.resultRecordedAt ?? input.resultRecordedAt,
      source: input.source,
      correctedAt: existing ? new Date().toISOString() : undefined,
      correctionCount: existing ? existing.correctionCount + 1 : 0,
    };
    this.byFixtureId.set(input.fixtureId, result);
    return result;
  }

  async getByFixtureId(fixtureId: UUID): Promise<MatchResult | undefined> {
    return this.byFixtureId.get(fixtureId);
  }
}

export class InMemoryMatchEventsRepository implements MatchEventsRepository {
  private readonly events: MatchEvent[] = [];

  async insert(input: NewMatchEventInput): Promise<MatchEvent> {
    if (input.providerEventId) {
      const existing = this.events.find((e) => e.provider === input.provider && e.providerEventId === input.providerEventId);
      if (existing) return existing;
    }
    const event: MatchEvent = {
      id: generateId(),
      fixtureId: input.fixtureId,
      eventType: input.eventType,
      providerEventType: input.providerEventType,
      teamId: input.teamId,
      minute: input.minute,
      observedAt: input.observedAt,
      provider: input.provider,
      providerEventId: input.providerEventId,
    };
    this.events.push(event);
    return event;
  }

  async listForFixture(fixtureId: UUID): Promise<readonly MatchEvent[]> {
    return this.events.filter((e) => e.fixtureId === fixtureId);
  }

  async listForFixtureAsOf(fixtureId: UUID, asOf: string): Promise<readonly MatchEvent[]> {
    const asOfMs = new Date(asOf).getTime();
    return this.events.filter((e) => e.fixtureId === fixtureId && new Date(e.observedAt).getTime() <= asOfMs);
  }
}

// ============================================================
// Supabase-backed implementations
// ============================================================

export class SupabaseFixturesRepository implements FixturesRepository {
  constructor(private readonly client: SupabaseClient) {}

  async upsert(input: NewFixtureInput): Promise<Fixture> {
    if (input.homeTeamId === input.awayTeamId) {
      throw new ValidationError({ message: "Fixture must have two distinct teams.", code: "FIXTURE_SAME_TEAM" });
    }
    const existing = await this.getByProviderIdentity(input.provider, input.providerFixtureId);
    const payload: Record<string, unknown> = {
      competition_id: input.competitionId,
      season_id: input.seasonId ?? null,
      home_team_id: input.homeTeamId,
      away_team_id: input.awayTeamId,
      status: input.status,
      provider_status_raw: input.providerStatusRaw ?? null,
      provider: input.provider,
      provider_fixture_id: input.providerFixtureId,
    };
    // scheduled_kickoff_at is only ever set on the FIRST insert.
    if (!existing) {
      payload.scheduled_kickoff_at = input.scheduledKickoffAt;
    }
    const { data, error } = await this.client.from("fixtures").upsert(payload, { onConflict: "provider,provider_fixture_id" }).select("*").single();
    if (error || !data) {
      throw new ValidationError({ message: "Failed to upsert fixture.", code: "FIXTURE_UPSERT_FAILED", context: { reason: error?.message } });
    }
    return fixtureRowToDomain(data as FixtureRow);
  }

  async getById(id: UUID): Promise<Fixture | undefined> {
    const { data, error } = await this.client.from("fixtures").select("*").eq("id", id).maybeSingle();
    if (error || !data) return undefined;
    return fixtureRowToDomain(data as FixtureRow);
  }

  async getByProviderIdentity(provider: string, providerFixtureId: string): Promise<Fixture | undefined> {
    const { data, error } = await this.client.from("fixtures").select("*").eq("provider", provider).eq("provider_fixture_id", providerFixtureId).maybeSingle();
    if (error || !data) return undefined;
    return fixtureRowToDomain(data as FixtureRow);
  }
}

export class SupabaseMatchResultsRepository implements MatchResultsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async upsert(input: NewMatchResultInput): Promise<MatchResult> {
    const existing = await this.getByFixtureId(input.fixtureId);
    const payload: Record<string, unknown> = {
      fixture_id: input.fixtureId,
      home_goals: input.homeGoals,
      away_goals: input.awayGoals,
      halftime_home_goals: input.halftimeHomeGoals ?? null,
      halftime_away_goals: input.halftimeAwayGoals ?? null,
      source: input.source,
    };
    if (!existing) {
      payload.result_recorded_at = input.resultRecordedAt;
    } else {
      payload.corrected_at = new Date().toISOString();
      payload.correction_count = existing.correctionCount + 1;
    }
    const { data, error } = await this.client.from("match_results").upsert(payload, { onConflict: "fixture_id" }).select("*").single();
    if (error || !data) {
      throw new ValidationError({ message: "Failed to upsert match result.", code: "MATCH_RESULT_UPSERT_FAILED", context: { reason: error?.message } });
    }
    return matchResultRowToDomain(data as MatchResultRow);
  }

  async getByFixtureId(fixtureId: UUID): Promise<MatchResult | undefined> {
    const { data, error } = await this.client.from("match_results").select("*").eq("fixture_id", fixtureId).maybeSingle();
    if (error || !data) return undefined;
    return matchResultRowToDomain(data as MatchResultRow);
  }
}

export class SupabaseMatchEventsRepository implements MatchEventsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async insert(input: NewMatchEventInput): Promise<MatchEvent> {
    const { data, error } = await this.client
      .from("match_events")
      .upsert(
        {
          fixture_id: input.fixtureId,
          event_type: input.eventType,
          provider_event_type: input.providerEventType ?? null,
          team_id: input.teamId ?? null,
          minute: input.minute ?? null,
          observed_at: input.observedAt,
          provider: input.provider,
          provider_event_id: input.providerEventId ?? null,
        },
        input.providerEventId ? { onConflict: "provider,provider_event_id" } : undefined,
      )
      .select("*")
      .single();
    if (error || !data) {
      throw new ValidationError({ message: "Failed to insert match event.", code: "MATCH_EVENT_INSERT_FAILED", context: { reason: error?.message } });
    }
    return matchEventRowToDomain(data as MatchEventRow);
  }

  async listForFixture(fixtureId: UUID): Promise<readonly MatchEvent[]> {
    const { data, error } = await this.client.from("match_events").select("*").eq("fixture_id", fixtureId).order("observed_at", { ascending: true });
    if (error || !data) return [];
    return (data as readonly MatchEventRow[]).map(matchEventRowToDomain);
  }

  async listForFixtureAsOf(fixtureId: UUID, asOf: string): Promise<readonly MatchEvent[]> {
    const { data, error } = await this.client.from("match_events").select("*").eq("fixture_id", fixtureId).lte("observed_at", asOf).order("observed_at", { ascending: true });
    if (error || !data) return [];
    return (data as readonly MatchEventRow[]).map(matchEventRowToDomain);
  }
}
