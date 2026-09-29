import { ValidationError, err, ok, type Result } from "@sport-os/shared";
import type { MatchEventType, MatchStatus, TemporalReliability } from "./canonical.js";

/**
 * Normalization boundary (Section 04 — Data Normalization). A raw
 * provider record is translated into one of these NORMALIZED shapes —
 * canonical field names/types, but foreign references are still
 * provider-scoped ids (`providerCompetitionId`, `providerHomeTeamId`,
 * ...), not internal UUIDs yet. Resolving those to internal UUIDs
 * (upsert-if-missing by provider+providerId, per "Entity Matching") is
 * ingestion.ts's job, not normalization's — normalization only concerns
 * itself with "is this one record well-shaped", never with what else
 * exists in the database.
 *
 * The actual raw -> normalized mapping is inherently provider-specific
 * (field names differ per provider) and therefore lives in each
 * concrete adapter (see adapters/test-fixture-provider.ts for the one
 * example this section has), never here — this file only holds the
 * target shapes and validation helpers every adapter's normalizer reuses.
 */

export interface NormalizedCompetition {
  readonly provider: string;
  readonly providerCompetitionId: string;
  readonly name: string;
  readonly country: string | undefined;
  readonly competitionType: string | undefined;
  readonly active: boolean;
}

export interface NormalizedSeason {
  readonly provider: string;
  readonly providerSeasonId: string;
  readonly providerCompetitionId: string;
  readonly name: string;
  readonly startDate: string | undefined;
  readonly endDate: string | undefined;
  readonly status: string | undefined;
}

export interface NormalizedTeam {
  readonly provider: string;
  readonly providerTeamId: string;
  readonly name: string;
  readonly shortName: string | undefined;
  readonly country: string | undefined;
}

export interface NormalizedFixture {
  readonly provider: string;
  readonly providerFixtureId: string;
  readonly providerCompetitionId: string;
  readonly providerSeasonId: string | undefined;
  readonly providerHomeTeamId: string;
  readonly providerAwayTeamId: string;
  readonly scheduledKickoffAt: string;
  readonly status: MatchStatus;
  readonly providerStatusRaw: string;
}

export interface NormalizedMatchResult {
  readonly providerFixtureId: string;
  readonly homeGoals: number;
  readonly awayGoals: number;
  readonly halftimeHomeGoals: number | undefined;
  readonly halftimeAwayGoals: number | undefined;
  readonly resultRecordedAt: string;
  readonly source: string;
}

export interface NormalizedMatchEvent {
  readonly provider: string;
  readonly providerEventId: string | undefined;
  readonly providerFixtureId: string;
  readonly eventType: MatchEventType;
  readonly providerEventType: string;
  readonly providerTeamId: string | undefined;
  readonly minute: number | undefined;
  readonly observedAt: string;
}

export interface NormalizedOddsObservation {
  readonly provider: string;
  readonly providerObservationId: string | undefined;
  readonly providerFixtureId: string;
  readonly marketType: string;
  readonly selection: string;
  readonly odds: number;
  readonly bookmakerSource: string;
  readonly observedAt: string;
  readonly providerPublishedAt: string | undefined;
  readonly temporalReliability: TemporalReliability;
}

// ============================================================
// Shared validation helpers — every provider-specific normalizer reuses
// these rather than re-implementing its own notion of "valid".
// ============================================================

export function requireNonEmptyString(value: unknown, field: string): Result<string, ValidationError> {
  if (typeof value !== "string" || value.trim().length === 0) {
    return err(new ValidationError({ message: `${field} must be a non-empty string.`, code: "NORMALIZE_INVALID_FIELD", context: { field } }));
  }
  return ok(value);
}

export function requireValidIsoDate(value: unknown, field: string): Result<string, ValidationError> {
  if (typeof value !== "string") {
    return err(new ValidationError({ message: `${field} must be an ISO-8601 timestamp string.`, code: "NORMALIZE_INVALID_FIELD", context: { field } }));
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return err(new ValidationError({ message: `${field} is not a valid timestamp.`, code: "NORMALIZE_INVALID_FIELD", context: { field, value } }));
  }
  return ok(parsed.toISOString());
}

export function requireNonNegativeInt(value: unknown, field: string): Result<number, ValidationError> {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return err(new ValidationError({ message: `${field} must be a non-negative integer.`, code: "NORMALIZE_INVALID_FIELD", context: { field, value } }));
  }
  return ok(value);
}

export function requirePositiveNumber(value: unknown, field: string): Result<number, ValidationError> {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return err(new ValidationError({ message: `${field} must be a positive number.`, code: "NORMALIZE_INVALID_FIELD", context: { field, value } }));
  }
  return ok(value);
}
