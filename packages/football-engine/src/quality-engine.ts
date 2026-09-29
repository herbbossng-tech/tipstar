import type { ISODateString } from "@sport-os/shared";
import type { Fixture, MatchEventType } from "./canonical.js";
import { MatchEventType as MatchEventTypeConst } from "./canonical.js";
import type { NormalizedFixture, NormalizedMatchEvent, NormalizedMatchResult, NormalizedOddsObservation } from "./normalize.js";
import type { DataQualityCheckResult, DataQualityResult } from "./quality-types.js";
import { QualityStatus } from "./quality-types.js";

/**
 * DataQualityEngine (Section 04 — Data Quality Engine). Fifteen named
 * checks spanning completeness / validity / consistency / freshness /
 * temporal integrity / uniqueness / source reliability — never reduced
 * to one unexplained number (see quality-types.ts's DataQualityResult).
 *
 * Every entity-level check here re-verifies things the corresponding
 * normalizer in normalize.ts / adapters/*.ts already validated. That is
 * deliberate defense in depth (the same reasoning as leakage-guard.ts's
 * re-checks), not redundancy for its own sake: a future normalizer bug
 * must still be caught here, before a bad record reaches a repository.
 */

const STALE_OBSERVATION_THRESHOLD_MS = 5 * 365 * 24 * 60 * 60 * 1000; // 5 years — a conservative default, not derived from provider guidance.
const MAX_SANE_MATCH_MINUTE = 130; // extra time + penalties headroom.

export interface QualityCheckContext {
  /** Injected rather than read from Date.now() so checks are deterministic and testable. */
  readonly now: ISODateString;
}

function pass(name: string, severity: "error" | "warning", message: string): DataQualityCheckResult {
  return { name, passed: true, severity, message };
}
function fail(name: string, severity: "error" | "warning", message: string): DataQualityCheckResult {
  return { name, passed: false, severity, message };
}

function isValidIsoTimestamp(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

function summarize(checks: readonly DataQualityCheckResult[]): DataQualityResult {
  const errors = checks.filter((c) => !c.passed && c.severity === "error").map((c) => c.message);
  const warnings = checks.filter((c) => !c.passed && c.severity === "warning").map((c) => c.message);
  const status: DataQualityResult["status"] = errors.length > 0 ? QualityStatus.INVALID : warnings.length > 0 ? QualityStatus.VALID_WITH_WARNINGS : QualityStatus.VALID;
  const score = checks.length === 0 ? 1 : checks.filter((c) => c.passed).length / checks.length;
  return { status, score, checks, warnings, errors };
}

// ============================================================
// 1-2: completeness · 3: validity (timestamp) · 4: consistency (teams)
// ============================================================

export function checkFixtureQuality(fixture: NormalizedFixture, _ctx: QualityCheckContext): DataQualityResult {
  const checks: DataQualityCheckResult[] = [];

  const hasRequiredFields = Boolean(fixture.providerFixtureId && fixture.providerCompetitionId && fixture.providerHomeTeamId && fixture.providerAwayTeamId);
  checks.push(hasRequiredFields ? pass("required_fields_present", "error", "All required fixture fields present.") : fail("required_fields_present", "error", "Fixture is missing a required identifying field."));

  const hasTeamRefs = Boolean(fixture.providerHomeTeamId && fixture.providerAwayTeamId);
  checks.push(hasTeamRefs ? pass("team_references_present", "error", "Home/away team references present.") : fail("team_references_present", "error", "Fixture is missing a home or away team reference."));

  checks.push(isValidIsoTimestamp(fixture.scheduledKickoffAt) ? pass("valid_timestamp", "error", "scheduledKickoffAt is a valid timestamp.") : fail("valid_timestamp", "error", "scheduledKickoffAt is not a valid timestamp."));

  checks.push(
    fixture.providerHomeTeamId !== fixture.providerAwayTeamId ? pass("distinct_teams", "error", "Home and away teams are distinct.") : fail("distinct_teams", "error", "Home and away teams must be distinct."),
  );

  return summarize(checks);
}

// ============================================================
// 5: validity (non-negative goals) · 6: consistency (halftime <= fulltime)
// · 8: temporal integrity (not future) · 10: temporal integrity (after kickoff)
// · 13: freshness (not stale)
// ============================================================

export function checkMatchResultQuality(result: NormalizedMatchResult, fixture: Fixture | undefined, ctx: QualityCheckContext): DataQualityResult {
  const checks: DataQualityCheckResult[] = [];

  checks.push(result.providerFixtureId ? pass("required_fields_present", "error", "Match result references a fixture.") : fail("required_fields_present", "error", "Match result is missing its fixture reference."));

  checks.push(isValidIsoTimestamp(result.resultRecordedAt) ? pass("valid_timestamp", "error", "resultRecordedAt is a valid timestamp.") : fail("valid_timestamp", "error", "resultRecordedAt is not a valid timestamp."));

  checks.push(
    result.homeGoals >= 0 && result.awayGoals >= 0 ? pass("non_negative_goals", "error", "Goal counts are non-negative.") : fail("non_negative_goals", "error", "Goal counts must be non-negative."),
  );

  const halftimeSane =
    result.halftimeHomeGoals === undefined || result.halftimeAwayGoals === undefined || (result.halftimeHomeGoals <= result.homeGoals && result.halftimeAwayGoals <= result.awayGoals);
  checks.push(halftimeSane ? pass("halftime_not_exceeding_fulltime", "warning", "Halftime goals do not exceed fulltime goals.") : fail("halftime_not_exceeding_fulltime", "warning", "Halftime goals exceed fulltime goals."));

  const resultMs = new Date(result.resultRecordedAt).getTime();
  const nowMs = new Date(ctx.now).getTime();
  checks.push(resultMs <= nowMs ? pass("observed_at_not_in_future", "error", "resultRecordedAt is not in the future.") : fail("observed_at_not_in_future", "error", "resultRecordedAt is in the future."));

  if (fixture) {
    const kickoffMs = new Date(fixture.scheduledKickoffAt).getTime();
    checks.push(
      resultMs >= kickoffMs ? pass("observed_after_kickoff", "warning", "Result was recorded at or after scheduled kickoff.") : fail("observed_after_kickoff", "warning", "Result was recorded before scheduled kickoff — suspicious."),
    );
  }

  checks.push(
    nowMs - resultMs <= STALE_OBSERVATION_THRESHOLD_MS
      ? pass("observation_not_stale", "warning", "Result is within the freshness window.")
      : fail("observation_not_stale", "warning", "Result is older than the configured freshness threshold."),
  );

  return summarize(checks);
}

// ============================================================
// 11: consistency (recognized event type) · 12: validity (minute bounds)
// ============================================================

const VALID_EVENT_TYPES: readonly MatchEventType[] = Object.values(MatchEventTypeConst);

export function checkMatchEventQuality(event: NormalizedMatchEvent, fixture: Fixture | undefined, ctx: QualityCheckContext): DataQualityResult {
  const checks: DataQualityCheckResult[] = [];

  checks.push(event.providerFixtureId ? pass("required_fields_present", "error", "Match event references a fixture.") : fail("required_fields_present", "error", "Match event is missing its fixture reference."));

  checks.push(isValidIsoTimestamp(event.observedAt) ? pass("valid_timestamp", "error", "observedAt is a valid timestamp.") : fail("valid_timestamp", "error", "observedAt is not a valid timestamp."));

  checks.push(
    VALID_EVENT_TYPES.includes(event.eventType) ? pass("event_type_recognized", "error", "Event type is a recognized canonical value.") : fail("event_type_recognized", "error", "Event type is not a recognized canonical value."),
  );

  const minuteSane = event.minute === undefined || (event.minute >= 0 && event.minute <= MAX_SANE_MATCH_MINUTE);
  checks.push(minuteSane ? pass("event_minute_within_bounds", "warning", "Event minute is within sane match bounds.") : fail("event_minute_within_bounds", "warning", "Event minute is outside sane match bounds."));

  const eventMs = new Date(event.observedAt).getTime();
  const nowMs = new Date(ctx.now).getTime();
  checks.push(eventMs <= nowMs ? pass("observed_at_not_in_future", "error", "observedAt is not in the future.") : fail("observed_at_not_in_future", "error", "observedAt is in the future."));

  if (fixture) {
    const kickoffMs = new Date(fixture.scheduledKickoffAt).getTime();
    checks.push(
      eventMs >= kickoffMs ? pass("observed_after_kickoff", "warning", "Event was observed at or after scheduled kickoff.") : fail("observed_after_kickoff", "warning", "Event was observed before scheduled kickoff — suspicious."),
    );
  }

  return summarize(checks);
}

// ============================================================
// 7: validity (positive odds) · 9: freshness (publish not after observe)
// · 15: source reliability (temporal reliability)
// ============================================================

export function checkOddsObservationQuality(odds: NormalizedOddsObservation, _fixture: Fixture | undefined, ctx: QualityCheckContext): DataQualityResult {
  const checks: DataQualityCheckResult[] = [];

  const hasRequiredFields = Boolean(odds.providerFixtureId && odds.marketType && odds.selection && odds.bookmakerSource);
  checks.push(hasRequiredFields ? pass("required_fields_present", "error", "All required odds fields present.") : fail("required_fields_present", "error", "Odds observation is missing a required field."));

  checks.push(isValidIsoTimestamp(odds.observedAt) ? pass("valid_timestamp", "error", "observedAt is a valid timestamp.") : fail("valid_timestamp", "error", "observedAt is not a valid timestamp."));

  checks.push(odds.odds > 0 ? pass("positive_odds", "error", "Odds value is positive.") : fail("positive_odds", "error", "Odds value must be positive."));

  if (odds.providerPublishedAt !== undefined) {
    const publishedMs = new Date(odds.providerPublishedAt).getTime();
    const observedMs = new Date(odds.observedAt).getTime();
    checks.push(
      publishedMs <= observedMs
        ? pass("published_at_not_after_observed_at", "warning", "providerPublishedAt is not after observedAt.")
        : fail("published_at_not_after_observed_at", "warning", "providerPublishedAt is after observedAt — possible clock skew."),
    );
  }

  const observedMs = new Date(odds.observedAt).getTime();
  const nowMs = new Date(ctx.now).getTime();
  checks.push(observedMs <= nowMs ? pass("observed_at_not_in_future", "error", "observedAt is not in the future.") : fail("observed_at_not_in_future", "error", "observedAt is in the future."));

  checks.push(
    odds.temporalReliability === "confirmed"
      ? pass("temporal_reliability_acceptable", "warning", "Odds carry a provider-confirmed timestamp.")
      : fail("temporal_reliability_acceptable", "warning", "Odds timestamp is estimated (no provider-published timestamp) — treat with reduced confidence."),
  );

  checks.push(
    nowMs - observedMs <= STALE_OBSERVATION_THRESHOLD_MS
      ? pass("observation_not_stale", "warning", "Odds observation is within the freshness window.")
      : fail("observation_not_stale", "warning", "Odds observation is older than the configured freshness threshold."),
  );

  return summarize(checks);
}

// ============================================================
// 14: uniqueness — batch-level, run once per ingested record set.
// Non-fatal (warning): idempotent upsert already makes a duplicate safe
// (see repositories/fixtures.ts etc.) — this check exists for
// observability, not to block ingestion.
// ============================================================

export function checkBatchUniqueness<T>(records: readonly T[], keyFn: (record: T) => string | undefined, entityLabel: string): DataQualityResult {
  const seen = new Map<string, number>();
  for (const record of records) {
    const key = keyFn(record);
    if (key === undefined) continue;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const duplicateKeys = [...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key);

  const check =
    duplicateKeys.length === 0
      ? pass("no_duplicate_provider_record_in_batch", "warning", `No duplicate ${entityLabel} records within this batch.`)
      : fail("no_duplicate_provider_record_in_batch", "warning", `${duplicateKeys.length} duplicate ${entityLabel} record id(s) within this batch: ${duplicateKeys.slice(0, 5).join(", ")}${duplicateKeys.length > 5 ? ", ..." : ""}.`);

  return summarize([check]);
}
