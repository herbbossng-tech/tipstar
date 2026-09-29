import type { ISODateString, UUID } from "@sport-os/shared";

/**
 * Canonical football data model (Section 04 — Canonical Football Data
 * Model). These are the ONLY shapes provider-specific code is allowed
 * to produce — a provider adapter's job is exactly to translate its own
 * format into these, never the reverse (see provider.ts).
 */

export const MatchStatus = {
  SCHEDULED: "scheduled",
  TIMED: "timed",
  LIVE: "live",
  HALFTIME: "halftime",
  FINISHED: "finished",
  POSTPONED: "postponed",
  CANCELLED: "cancelled",
  ABANDONED: "abandoned",
  SUSPENDED: "suspended",
  UNKNOWN: "unknown",
} as const;
export type MatchStatus = (typeof MatchStatus)[keyof typeof MatchStatus];

/** Statuses under which a match is still to come — never treated as FINAL. */
export const UPCOMING_MATCH_STATUSES: readonly MatchStatus[] = [MatchStatus.SCHEDULED, MatchStatus.TIMED, MatchStatus.POSTPONED];
/** Statuses under which a match is in progress — never treated as FINAL, per "Live vs Historical". */
export const LIVE_MATCH_STATUSES: readonly MatchStatus[] = [MatchStatus.LIVE, MatchStatus.HALFTIME, MatchStatus.SUSPENDED];
/** The only statuses under which a MatchResult may be treated as final. */
export const FINAL_MATCH_STATUSES: readonly MatchStatus[] = [MatchStatus.FINISHED];

export const MatchEventType = {
  GOAL: "goal",
  OWN_GOAL: "own_goal",
  PENALTY_GOAL: "penalty_goal",
  MISSED_PENALTY: "missed_penalty",
  YELLOW_CARD: "yellow_card",
  RED_CARD: "red_card",
  SUBSTITUTION: "substitution",
  VAR: "var",
} as const;
export type MatchEventType = (typeof MatchEventType)[keyof typeof MatchEventType];

export const IngestionMode = { BACKFILL: "backfill", LIVE: "live" } as const;
export type IngestionMode = (typeof IngestionMode)[keyof typeof IngestionMode];

export const IngestionRunStatus = { RUNNING: "running", COMPLETED: "completed", PARTIAL: "partial", FAILED: "failed" } as const;
export type IngestionRunStatus = (typeof IngestionRunStatus)[keyof typeof IngestionRunStatus];

export const TemporalReliability = { CONFIRMED: "confirmed", ESTIMATED: "estimated" } as const;
export type TemporalReliability = (typeof TemporalReliability)[keyof typeof TemporalReliability];

/** A provider identifier is namespaced by provider — never assumed globally unique across providers. See "Entity Matching". */
export interface ProviderIdentity {
  readonly provider: string;
  readonly providerId: string;
}

export interface DataSource {
  readonly id: UUID;
  readonly provider: string;
  readonly displayName: string;
  readonly kind: "football_data" | "odds";
  readonly enabled: boolean;
  readonly baseUrl: string | undefined;
}

export interface Competition {
  readonly id: UUID;
  readonly provider: string;
  readonly providerCompetitionId: string;
  readonly name: string;
  readonly country: string | undefined;
  readonly competitionType: string | undefined;
  readonly active: boolean;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
}

export interface Season {
  readonly id: UUID;
  readonly competitionId: UUID;
  readonly provider: string;
  readonly providerSeasonId: string;
  readonly name: string;
  readonly startDate: string | undefined;
  readonly endDate: string | undefined;
  readonly status: string | undefined;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
}

export interface Venue {
  readonly id: UUID;
  readonly provider: string | undefined;
  readonly providerVenueId: string | undefined;
  readonly name: string;
  readonly city: string | undefined;
  readonly country: string | undefined;
}

export interface Team {
  readonly id: UUID;
  readonly provider: string;
  readonly providerTeamId: string;
  readonly name: string;
  readonly shortName: string | undefined;
  readonly country: string | undefined;
  readonly venueId: UUID | undefined;
  readonly active: boolean;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
}

export interface Fixture {
  readonly id: UUID;
  readonly competitionId: UUID;
  readonly seasonId: UUID | undefined;
  readonly homeTeamId: UUID;
  readonly awayTeamId: UUID;
  /** Set once, never overwritten merely because the match was delayed — see actualKickoffAt. */
  readonly scheduledKickoffAt: ISODateString;
  readonly actualKickoffAt: ISODateString | undefined;
  /** Current/latest known status — mutable, NOT point-in-time-safe. A historical snapshot must use FixturesRepository.getByIdAsOf instead, which reconstructs this field (and providerStatusRaw/actualKickoffAt) from fixture_status_observations as of the requested time. */
  readonly status: MatchStatus;
  /** Original provider status string, preserved for provenance (e.g. "FT" alongside FINISHED). */
  readonly providerStatusRaw: string | undefined;
  readonly venueId: UUID | undefined;
  readonly provider: string;
  readonly providerFixtureId: string;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
}

/**
 * One immutable VERSION of a fixture's result — never mutated once
 * written. A correction is always a new version (its own row, its own
 * `id`), never an edit to a prior one: see MatchResultsRepository.
 */
export interface MatchResult {
  readonly id: UUID;
  readonly fixtureId: UUID;
  readonly homeGoals: number;
  readonly awayGoals: number;
  readonly halftimeHomeGoals: number | undefined;
  readonly halftimeAwayGoals: number | undefined;
  /** When THIS version became known — immutable once written, never inherited from an earlier or later version. The point-in-time filtering field: a query for asOf=T must use the version with the greatest resultRecordedAt <= T. */
  readonly resultRecordedAt: ISODateString;
  readonly source: string;
  /** undefined for the original version; set for every version after it. */
  readonly correctedAt: ISODateString | undefined;
  /** 0 for the original version, incrementing by 1 for each correction after it. */
  readonly correctionCount: number;
}

export interface MatchEvent {
  readonly id: UUID;
  readonly fixtureId: UUID;
  readonly eventType: MatchEventType;
  readonly providerEventType: string | undefined;
  readonly teamId: UUID | undefined;
  readonly minute: number | undefined;
  /** The point-in-time field LeakageGuard filters on. */
  readonly observedAt: ISODateString;
  readonly provider: string;
  readonly providerEventId: string | undefined;
}

/**
 * A flexible, provider-supplied metrics bag (form, goals for/against,
 * xG, shots, possession, corners, cards, standings — whatever the
 * provider actually reports). Deliberately NOT a fixed schema: Section
 * 05 owns feature engineering; Section 04 only preserves what a
 * provider genuinely supplied, never fabricating a field it lacks.
 */
export interface TeamObservation {
  readonly id: UUID;
  readonly teamId: UUID;
  readonly fixtureId: UUID | undefined;
  readonly competitionId: UUID | undefined;
  readonly observationType: string;
  readonly metrics: Readonly<Record<string, number | string | boolean | null>>;
  readonly observedAt: ISODateString;
  readonly providerPublishedAt: ISODateString | undefined;
  readonly sourceUpdatedAt: ISODateString | undefined;
  readonly provider: string;
  readonly providerObservationId: string | undefined;
  readonly ingestionRunId: UUID | undefined;
}

export interface OddsObservation {
  readonly id: UUID;
  readonly fixtureId: UUID;
  /** A @sport-os/market-engine MarketType value, validated at the application layer — see odds.ts. */
  readonly marketType: string;
  readonly selection: string;
  readonly odds: number;
  readonly bookmakerSource: string;
  readonly observedAt: ISODateString;
  readonly providerPublishedAt: ISODateString | undefined;
  readonly temporalReliability: TemporalReliability;
  readonly provider: string;
  readonly providerObservationId: string | undefined;
  readonly ingestionRunId: UUID | undefined;
}

export interface IngestionRun {
  readonly id: UUID;
  readonly provider: string;
  readonly mode: IngestionMode;
  readonly status: IngestionRunStatus;
  readonly startedAt: ISODateString;
  readonly completedAt: ISODateString | undefined;
  readonly recordsReceived: number;
  readonly recordsInserted: number;
  readonly recordsUpdated: number;
  readonly recordsRejected: number;
  readonly errorCount: number;
  readonly metadata: Readonly<Record<string, unknown>>;
}

// ============================================================
// Status normalization (Section 04 — Data Normalization / Match Status)
// ============================================================

/**
 * Maps a provider's raw status string to a canonical MatchStatus.
 * Unrecognized values normalize to UNKNOWN — never silently dropped or
 * guessed as something more specific than the evidence supports. The
 * original string is always preserved separately (Fixture.providerStatusRaw).
 */
export type MatchStatusNormalizer = (providerStatusRaw: string) => MatchStatus;

/** A conservative default normalizer for the common short-code convention (e.g. football-data.org-style "FT"/"NS"/"1H"). Provider adapters may supply their own when a provider's convention differs. */
export function normalizeCommonMatchStatus(providerStatusRaw: string): MatchStatus {
  const code = providerStatusRaw.trim().toUpperCase();
  switch (code) {
    case "NS":
    case "SCHEDULED":
      return MatchStatus.SCHEDULED;
    case "TIMED":
      return MatchStatus.TIMED;
    case "1H":
    case "2H":
    case "LIVE":
    case "IN_PLAY":
      return MatchStatus.LIVE;
    case "HT":
    case "HALFTIME":
      return MatchStatus.HALFTIME;
    case "FT":
    case "AET":
    case "PEN":
    case "FINISHED":
      return MatchStatus.FINISHED;
    case "PST":
    case "POSTPONED":
      return MatchStatus.POSTPONED;
    case "CANC":
    case "CANCELLED":
      return MatchStatus.CANCELLED;
    case "AWD":
    case "ABANDONED":
      return MatchStatus.ABANDONED;
    case "SUSP":
    case "SUSPENDED":
      return MatchStatus.SUSPENDED;
    default:
      return MatchStatus.UNKNOWN;
  }
}
