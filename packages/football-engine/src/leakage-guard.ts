import { InternalError, ValidationError, err, ok, type AppError, type ISODateString, type Result, type UUID } from "@sport-os/shared";
import type { Fixture, MatchEvent, MatchResult, OddsObservation, TeamObservation } from "./canonical.js";
import type { FixturesRepository, MatchEventsRepository, MatchResultsRepository } from "./repositories/fixtures.js";
import type { OddsObservationsRepository, TeamObservationsRepository } from "./repositories/observations.js";

/**
 * LeakageGuard (Section 04 — the section's most important component).
 * Protects historical feature construction with one core rule:
 *
 *   observation.observedAt <= snapshotTime
 *
 * and the observation must represent information genuinely available at
 * that time — never post-hoc knowledge presented as if it existed
 * earlier. See docs/architecture/LEAKAGE_PROTECTION.md.
 */

export const LeakageType = {
  FUTURE_RESULT_LEAKAGE: "FUTURE_RESULT_LEAKAGE",
  FUTURE_ODDS_LEAKAGE: "FUTURE_ODDS_LEAKAGE",
  FUTURE_EVENT_LEAKAGE: "FUTURE_EVENT_LEAKAGE",
  FUTURE_LINEUP_LEAKAGE: "FUTURE_LINEUP_LEAKAGE",
  FUTURE_INJURY_LEAKAGE: "FUTURE_INJURY_LEAKAGE",
  FUTURE_STANDING_LEAKAGE: "FUTURE_STANDING_LEAKAGE",
  FUTURE_FEATURE_LEAKAGE: "FUTURE_FEATURE_LEAKAGE",
  TARGET_LEAKAGE: "TARGET_LEAKAGE",
  DATASET_SPLIT_LEAKAGE: "DATASET_SPLIT_LEAKAGE",
} as const;
export type LeakageType = (typeof LeakageType)[keyof typeof LeakageType];

/**
 * The Section 05 contract: "Give me the football data available as of
 * SNAPSHOT_TIME for FIXTURE_ID." Every field here is already filtered to
 * `<= snapshotTime` before this type is ever constructed — there is no
 * field on this type a caller could misuse to accidentally read future
 * information, because future information was never fetched into it.
 */
export interface FixtureSnapshot {
  readonly fixtureId: UUID;
  readonly snapshotTime: ISODateString;
  readonly fixture: Fixture;
  /** undefined when no result exists yet, OR when one exists but was recorded after snapshotTime — the caller cannot distinguish these two cases from this field alone, which is correct: neither may be used as of this snapshot. */
  readonly matchResult: MatchResult | undefined;
  readonly events: readonly MatchEvent[];
  readonly homeTeamObservations: readonly TeamObservation[];
  readonly awayTeamObservations: readonly TeamObservation[];
  readonly oddsObservations: readonly OddsObservation[];
}

export interface LeakageGuardDependencies {
  readonly fixtures: FixturesRepository;
  readonly matchResults: MatchResultsRepository;
  readonly matchEvents: MatchEventsRepository;
  readonly teamObservations: TeamObservationsRepository;
  readonly oddsObservations: OddsObservationsRepository;
}

function isAtOrBefore(observedAt: ISODateString, snapshotMs: number): boolean {
  return new Date(observedAt).getTime() <= snapshotMs;
}

/**
 * The point-in-time query contract (Section 04 — Point-In-Time Query
 * Contract / Section 05 Contract). Repositories already filter by
 * `observedAt <= asOf` at the query layer (see repositories/*.ts's
 * `*AsOf` methods) — the re-checks below are deliberate defense in
 * depth: a future bug in one repository's query must never silently
 * leak future data past this specific boundary, which is why this
 * function, not the repositories alone, is what Section 05 is told to
 * depend on.
 */
export async function getDataAsOf(deps: LeakageGuardDependencies, fixtureId: UUID, snapshotTime: ISODateString): Promise<Result<FixtureSnapshot, AppError>> {
  const snapshotMs = new Date(snapshotTime).getTime();
  if (Number.isNaN(snapshotMs)) {
    return err(new ValidationError({ message: "snapshotTime is not a valid timestamp.", code: "INVALID_SNAPSHOT_TIME" }));
  }

  // Point-in-time-safe: reconstructs status/providerStatusRaw/
  // actualKickoffAt from fixture_status_observations as of snapshotTime
  // — never the fixture's current (possibly future-relative-to-snapshot)
  // status. See repositories/fixtures.ts's FixturesRepository.getByIdAsOf.
  const fixture = await deps.fixtures.getByIdAsOf(fixtureId, snapshotTime);
  if (!fixture) {
    return err(new ValidationError({ message: "Fixture not found, or not yet known as of the requested snapshot time.", code: "FIXTURE_NOT_FOUND" }));
  }

  // Point-in-time-safe: resolves to the result VERSION with the greatest
  // resultRecordedAt <= snapshotTime — never a single mutable row whose
  // original timestamp survives a later correction. See
  // MatchResultsRepository.getAsOf.
  const matchResult = await deps.matchResults.getAsOf(fixtureId, snapshotTime);
  if (matchResult && !isAtOrBefore(matchResult.resultRecordedAt, snapshotMs)) {
    return err(new InternalError({ message: "LeakageGuard: a future match result was returned by a point-in-time query.", code: LeakageType.FUTURE_RESULT_LEAKAGE, context: { fixtureId } }));
  }

  const events = await deps.matchEvents.listForFixtureAsOf(fixtureId, snapshotTime);
  for (const event of events) {
    if (!isAtOrBefore(event.observedAt, snapshotMs)) {
      return err(new InternalError({ message: "LeakageGuard: a future match event was returned by a point-in-time query.", code: LeakageType.FUTURE_EVENT_LEAKAGE, context: { fixtureId, eventId: event.id } }));
    }
  }

  const homeTeamObservations = await deps.teamObservations.listForTeamAsOf(fixture.homeTeamId, snapshotTime);
  const awayTeamObservations = await deps.teamObservations.listForTeamAsOf(fixture.awayTeamId, snapshotTime);
  for (const observation of [...homeTeamObservations, ...awayTeamObservations]) {
    if (!isAtOrBefore(observation.observedAt, snapshotMs)) {
      return err(new InternalError({ message: "LeakageGuard: a future team observation was returned by a point-in-time query.", code: LeakageType.FUTURE_STANDING_LEAKAGE, context: { fixtureId, observationId: observation.id } }));
    }
  }

  const oddsObservations = await deps.oddsObservations.listForFixtureAsOf(fixtureId, snapshotTime);
  for (const observation of oddsObservations) {
    if (!isAtOrBefore(observation.observedAt, snapshotMs)) {
      return err(new InternalError({ message: "LeakageGuard: future odds were returned by a point-in-time query.", code: LeakageType.FUTURE_ODDS_LEAKAGE, context: { fixtureId, observationId: observation.id } }));
    }
  }

  return ok({ fixtureId, snapshotTime, fixture, matchResult, events, homeTeamObservations, awayTeamObservations, oddsObservations });
}

/**
 * Pre-match snapshot boundary helper (Section 04 — Pre-Match Snapshot).
 * `leadTimeMinutes` is never hard-coded/defaulted by this function — the
 * caller must supply it explicitly, since the architecture does not
 * specify one universal lead time.
 */
export function computePreMatchSnapshotTime(fixture: Fixture, leadTimeMinutes: number): ISODateString {
  const kickoffMs = new Date(fixture.scheduledKickoffAt).getTime();
  return new Date(kickoffMs - leadTimeMinutes * 60_000).toISOString();
}
