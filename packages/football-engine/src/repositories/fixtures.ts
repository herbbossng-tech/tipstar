import { generateId, ValidationError, type UUID } from "@sport-os/shared";
import type { SupabaseClient } from "@sport-os/platform";
import type { Fixture, MatchEvent, MatchResult, MatchStatus } from "../canonical.js";
import type { FixtureRow, FixtureStatusObservationRow, MatchEventRow, MatchResultRow } from "../db/types.js";

/**
 * Fixture/MatchResult/MatchEvent repositories (Section 04 — Fixture /
 * Match Result / Match Events / Point-In-Time Query Contract fix, plus
 * the PR review hardening pass below).
 *
 * Fixture IDENTITY (competition/season/home/away team) and
 * scheduledKickoffAt are immutable once set — a repeat sighting can
 * never rewrite them, at either layer (see `upsert()`'s implementations
 * and, for Supabase, the `upsert_fixture_with_status_observation` SQL
 * function's deliberately narrow `on conflict ... do update set`).
 * `ingestion.ts` additionally quarantines any raw record whose resolved
 * identity disagrees with the fixture already on file, rather than
 * silently discarding the disagreement — see
 * FOOTBALL_DATA_ARCHITECTURE.md's "Fixture identity immutability".
 * "Current state" (status/providerStatusRaw/actualKickoffAt) IS safely
 * upsertable in place — but that is exactly what makes it unsafe for a
 * historical point-in-time read. Every status transition is additionally
 * recorded as an immutable fixture_status_observations row, so
 * `getByIdAsOf` can reconstruct what status was actually known as of any
 * past `asOf` — never the fixture's current (possibly future-relative-
 * to-asOf) status. The fixture mutation and its corresponding
 * observation are written as one atomic operation (a single SQL function
 * for Supabase; a single method body with commit-only-on-full-success
 * ordering for the in-memory double) — never a state where one commits
 * without the other.
 *
 * Match results are append-only VERSIONS (never updated in place): a
 * correction is a new row, and `getAsOf` resolves "what did we know as
 * of T" from that history, never from a single mutable row whose
 * original timestamp survives a later correction. Versions are ordered
 * by `resultRecordedAt` (temporal) with a deterministic tiebreaker for
 * versions sharing the same timestamp (insertion order in memory;
 * `version_seq` in Postgres — see the match_results migration).
 *
 * MatchEvents are append-only, unchanged.
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
  /** When this sighting of the fixture's status was made. Most providers don't timestamp status transitions themselves — this defaults to "now" (real ingestion time) when omitted, which is what ingestion.ts relies on; tests may supply an explicit value to control the point-in-time timeline deterministically. */
  readonly observedAt?: string;
}

export interface FixturesRepository {
  /**
   * Inserts on first sight; on a repeat sighting, only status/
   * providerStatusRaw/actualKickoffAt may change — scheduledKickoffAt
   * AND identity fields (competitionId/seasonId/homeTeamId/awayTeamId)
   * are set once and never touched again, regardless of what `input`
   * contains on a later call (see "Fixture identity immutability"
   * above; callers that need to detect a disagreeing repeat sighting
   * should compare against the previously-stored fixture themselves —
   * see ingestion.ts). Whenever status/providerStatusRaw/actualKickoffAt
   * actually changed (or this is the first sighting), also appends an
   * immutable fixture_status_observations row, as ONE atomic operation
   * with the fixture mutation — a failure recording the observation
   * must leave the fixture mutation uncommitted too, never partially
   * applied.
   */
  upsert(input: NewFixtureInput): Promise<Fixture>;
  /** Current/latest known state — NOT point-in-time-safe (status may be later than a historical asOf). Never use for historical feature construction; use getByIdAsOf. */
  getById(id: UUID): Promise<Fixture | undefined>;
  getByProviderIdentity(provider: string, providerFixtureId: string): Promise<Fixture | undefined>;
  /**
   * The point-in-time-safe read (Section 04 fix — Mutable Fixture Status
   * Leakage). Identity fields (competition/season/teams/
   * scheduledKickoffAt/provider identity) are immutable and always
   * current; status/providerStatusRaw/actualKickoffAt are reconstructed
   * from the latest fixture_status_observations row with `observedAt <=
   * asOf`. Returns undefined if nothing was knowable about this
   * fixture's status as of that time yet (including if the fixture
   * itself doesn't exist) — never a future status.
   */
  getByIdAsOf(id: UUID, asOf: string): Promise<Fixture | undefined>;
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
  /** Appends a new, immutable result VERSION — the first call for a fixture is the original; every subsequent call is a provider correction (its own new row, never an overwrite of a prior version). */
  insert(input: NewMatchResultInput): Promise<MatchResult>;
  /** Current/latest known version (by resultRecordedAt) — a "now" read, NOT point-in-time-safe. Never use for historical feature construction; use getAsOf. */
  getLatest(fixtureId: UUID): Promise<MatchResult | undefined>;
  /** The point-in-time-safe read (Section 04 fix — Match Result Correction Leakage): the version with the greatest resultRecordedAt <= asOf, or undefined if none was known yet as of that time. */
  getAsOf(fixtureId: UUID, asOf: string): Promise<MatchResult | undefined>;
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

/** The subset of Fixture that a fixture_status_observations row can tell us about — used to overlay onto the immutable identity fields for a point-in-time read. */
interface FixtureStatusSnapshot {
  readonly status: MatchStatus;
  readonly providerStatusRaw: string | undefined;
  readonly actualKickoffAt: string | undefined;
  readonly observedAt: string;
}

function fixtureStatusObservationRowToSnapshot(row: FixtureStatusObservationRow): FixtureStatusSnapshot {
  return {
    status: row.status,
    providerStatusRaw: row.provider_status_raw ?? undefined,
    actualKickoffAt: row.actual_kickoff_at ?? undefined,
    observedAt: row.observed_at,
  };
}

/**
 * Picks the observation with the greatest timestamp from a non-empty
 * list — the "as of this moment, latest known" resolution rule shared
 * by both the fixture-status and match-result point-in-time reads.
 *
 * Deterministic even when two items share the exact same timestamp
 * (PR review fix — Deterministic Match-Result Version Ordering): `>=`
 * means a later item in `items` replaces an earlier one on a tie, and
 * every caller here passes `items` in original insertion order (a plain
 * `.filter()` over an append-only array never reorders), so ties always
 * resolve to the most-recently-inserted version — the same guarantee
 * `version_seq` gives the Supabase implementation, which cannot rely on
 * JS array order and needs an explicit column instead.
 */
function latestByTimestamp<T>(items: readonly T[], getTimestamp: (item: T) => string): T {
  return items.reduce((latest, item) => (new Date(getTimestamp(item)).getTime() >= new Date(getTimestamp(latest)).getTime() ? item : latest));
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
  private readonly statusObservations: (FixtureStatusSnapshot & { fixtureId: UUID })[] = [];

  /**
   * @param onStatusObservation Optional hook invoked with each new
   * observation the way `upsert()` would otherwise record it directly —
   * tests use this to simulate a failing history write. If it throws,
   * `upsert()` propagates the error and, critically, never applies the
   * fixture-state mutation: see the ordering below, which mirrors the
   * atomicity guarantee `upsert_fixture_with_status_observation` gives
   * in Postgres (both writes happen, or neither does).
   */
  constructor(private readonly onStatusObservation?: (observation: FixtureStatusSnapshot & { fixtureId: UUID }) => void) {}

  async upsert(input: NewFixtureInput): Promise<Fixture> {
    if (input.homeTeamId === input.awayTeamId) {
      throw new ValidationError({ message: "Fixture must have two distinct teams.", code: "FIXTURE_SAME_TEAM" });
    }
    const existing = await this.getByProviderIdentity(input.provider, input.providerFixtureId);
    const now = new Date().toISOString();
    const observedAt = input.observedAt ?? now;
    const fixture: Fixture = {
      id: existing?.id ?? generateId(),
      // Identity fields are set once, on first sighting, and never
      // touched again — a repeat sighting's input is ignored for these,
      // exactly like scheduledKickoffAt below. A caller that needs to
      // detect (and quarantine) a provider reporting a DIFFERENT
      // identity for an existing fixture must compare against the
      // previously-stored fixture before calling upsert() — see
      // ingestion.ts, which is the only production caller.
      competitionId: existing?.competitionId ?? input.competitionId,
      seasonId: existing ? existing.seasonId : input.seasonId,
      homeTeamId: existing?.homeTeamId ?? input.homeTeamId,
      awayTeamId: existing?.awayTeamId ?? input.awayTeamId,
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

    // Record an immutable status observation whenever this is the first
    // sighting, or status/providerStatusRaw/actualKickoffAt actually
    // changed — never on an unchanged re-poll, to avoid unbounded growth.
    const statusChanged =
      !existing || existing.status !== fixture.status || existing.providerStatusRaw !== fixture.providerStatusRaw || existing.actualKickoffAt !== fixture.actualKickoffAt;
    if (statusChanged) {
      const observation = { fixtureId: fixture.id, status: fixture.status, providerStatusRaw: fixture.providerStatusRaw, actualKickoffAt: fixture.actualKickoffAt, observedAt };
      // The history write happens BEFORE the fixture-state mutation
      // below is applied. If it throws, `this.byId.set` below never
      // runs, so the fixture map is left exactly as it was before this
      // call (untouched on a first sighting; unchanged at `existing` on
      // a repeat one) — no partial state, mirroring one atomic
      // transaction.
      this.onStatusObservation?.(observation);
      this.statusObservations.push(observation);
    }

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

  async getByIdAsOf(id: UUID, asOf: string): Promise<Fixture | undefined> {
    const fixture = this.byId.get(id);
    if (!fixture) return undefined;
    const asOfMs = new Date(asOf).getTime();
    const eligible = this.statusObservations.filter((o) => o.fixtureId === id && new Date(o.observedAt).getTime() <= asOfMs);
    if (eligible.length === 0) return undefined;
    const latest = latestByTimestamp(eligible, (o) => o.observedAt);
    return { ...fixture, status: latest.status, providerStatusRaw: latest.providerStatusRaw, actualKickoffAt: latest.actualKickoffAt };
  }
}

export class InMemoryMatchResultsRepository implements MatchResultsRepository {
  private readonly versions: MatchResult[] = [];

  async insert(input: NewMatchResultInput): Promise<MatchResult> {
    const priorVersions = this.versions.filter((v) => v.fixtureId === input.fixtureId);
    const isCorrection = priorVersions.length > 0;
    const version: MatchResult = {
      id: generateId(),
      fixtureId: input.fixtureId,
      homeGoals: input.homeGoals,
      awayGoals: input.awayGoals,
      halftimeHomeGoals: input.halftimeHomeGoals,
      halftimeAwayGoals: input.halftimeAwayGoals,
      // This version's OWN timestamp — never inherited from a prior
      // version. This is exactly what a correction previously got
      // wrong: reusing the original resultRecordedAt let the corrected
      // score leak through a historical asOf check.
      resultRecordedAt: input.resultRecordedAt,
      source: input.source,
      correctedAt: isCorrection ? new Date().toISOString() : undefined,
      correctionCount: priorVersions.length,
    };
    this.versions.push(version);
    return version;
  }

  async getLatest(fixtureId: UUID): Promise<MatchResult | undefined> {
    const versions = this.versions.filter((v) => v.fixtureId === fixtureId);
    if (versions.length === 0) return undefined;
    return latestByTimestamp(versions, (v) => v.resultRecordedAt);
  }

  async getAsOf(fixtureId: UUID, asOf: string): Promise<MatchResult | undefined> {
    const asOfMs = new Date(asOf).getTime();
    const eligible = this.versions.filter((v) => v.fixtureId === fixtureId && new Date(v.resultRecordedAt).getTime() <= asOfMs);
    if (eligible.length === 0) return undefined;
    return latestByTimestamp(eligible, (v) => v.resultRecordedAt);
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
    // Atomic (PR review fix — Atomic Fixture Upsert): a single RPC call
    // into public.upsert_fixture_with_status_observation(), which
    // performs the fixtures upsert AND, when warranted, the
    // fixture_status_observations insert inside one Postgres function
    // body — never two separate round-trips where the first could
    // commit while the second fails. See that function's migration
    // (20260929130460_fixture_upsert_atomic.sql) for the full atomicity
    // and identity-immutability argument.
    const { data, error } = await this.client.rpc("upsert_fixture_with_status_observation", {
      p_competition_id: input.competitionId,
      p_season_id: input.seasonId ?? null,
      p_home_team_id: input.homeTeamId,
      p_away_team_id: input.awayTeamId,
      p_scheduled_kickoff_at: input.scheduledKickoffAt,
      p_status: input.status,
      p_provider_status_raw: input.providerStatusRaw ?? null,
      p_provider: input.provider,
      p_provider_fixture_id: input.providerFixtureId,
      p_observed_at: input.observedAt ?? new Date().toISOString(),
    });
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

  async getByIdAsOf(id: UUID, asOf: string): Promise<Fixture | undefined> {
    const fixture = await this.getById(id);
    if (!fixture) return undefined;
    const { data, error } = await this.client
      .from("fixture_status_observations")
      .select("*")
      .eq("fixture_id", id)
      .lte("observed_at", asOf)
      .order("observed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return undefined;
    const snapshot = fixtureStatusObservationRowToSnapshot(data as FixtureStatusObservationRow);
    return { ...fixture, status: snapshot.status, providerStatusRaw: snapshot.providerStatusRaw, actualKickoffAt: snapshot.actualKickoffAt };
  }
}

export class SupabaseMatchResultsRepository implements MatchResultsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async insert(input: NewMatchResultInput): Promise<MatchResult> {
    const existing = await this.getLatest(input.fixtureId);
    const payload = {
      fixture_id: input.fixtureId,
      home_goals: input.homeGoals,
      away_goals: input.awayGoals,
      halftime_home_goals: input.halftimeHomeGoals ?? null,
      halftime_away_goals: input.halftimeAwayGoals ?? null,
      // This version's OWN timestamp — never inherited from a prior
      // version (see InMemoryMatchResultsRepository's comment for why
      // that was the bug).
      result_recorded_at: input.resultRecordedAt,
      source: input.source,
      corrected_at: existing ? new Date().toISOString() : null,
      correction_count: existing ? existing.correctionCount + 1 : 0,
    };
    // Always an INSERT — never an upsert/onConflict — since match_results
    // has no uniqueness constraint on fixture_id any more: every call
    // appends a new, immutable version row.
    const { data, error } = await this.client.from("match_results").insert(payload).select("*").single();
    if (error || !data) {
      throw new ValidationError({ message: "Failed to insert match result.", code: "MATCH_RESULT_INSERT_FAILED", context: { reason: error?.message } });
    }
    return matchResultRowToDomain(data as MatchResultRow);
  }

  async getLatest(fixtureId: UUID): Promise<MatchResult | undefined> {
    // Ordered by result_recorded_at (temporal), then version_seq (PR
    // review fix — Deterministic Match-Result Version Ordering: a
    // purely-ordinal, auto-incrementing tiebreaker) so two versions
    // sharing the exact same result_recorded_at resolve deterministically
    // to the most recently inserted one, never an arbitrary row Postgres
    // happens to return first.
    const { data, error } = await this.client
      .from("match_results")
      .select("*")
      .eq("fixture_id", fixtureId)
      .order("result_recorded_at", { ascending: false })
      .order("version_seq", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return undefined;
    return matchResultRowToDomain(data as MatchResultRow);
  }

  async getAsOf(fixtureId: UUID, asOf: string): Promise<MatchResult | undefined> {
    const { data, error } = await this.client
      .from("match_results")
      .select("*")
      .eq("fixture_id", fixtureId)
      .lte("result_recorded_at", asOf)
      .order("result_recorded_at", { ascending: false })
      .order("version_seq", { ascending: false })
      .limit(1)
      .maybeSingle();
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
