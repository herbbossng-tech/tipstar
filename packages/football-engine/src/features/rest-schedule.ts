import type { Fixture } from "../canonical.js";
import type { HistoryDependencies } from "./history.js";
import { FeatureFamily, FeatureQuality, missingFeatureValue, type FeatureComputationContext, type FeatureDefinition, type FeatureValue } from "./types.js";

/**
 * Rest / Schedule — Section 05 §5.C. Uses only kickoff dates (always
 * known ahead of time, never leakage-sensitive on their own) of a
 * team's prior fixtures — does not depend on those matches' results at
 * all, so it reuses getTeamMatchHistory purely for its already-
 * leakage-safe fixture list rather than because congestion needs result
 * data.
 */

const CONGESTION_WINDOW_DAYS = 14;

function featureId(side: "home" | "away", metric: string): string {
  return `${side}_team_${metric}`;
}

export const REST_SCHEDULE_FEATURE_DEFINITIONS: readonly FeatureDefinition[] = (["home", "away"] as const).flatMap((side) => {
  const teamLabel = side === "home" ? "home team" : "away team";
  return [
    {
      featureId: featureId(side, "days_since_previous_match"),
      name: `${teamLabel} days since previous match`,
      version: 1,
      description: `Days between the ${teamLabel}'s most recent prior fixture kickoff and this fixture's kickoff.`,
      family: FeatureFamily.REST_SCHEDULE,
      dataDependencies: ["fixtures"],
      lookback: "most recent 1 prior fixture",
      computationTimestampRule: "Only fixtures with scheduledKickoffAt strictly before this fixture's kickoff.",
      availabilityRequirement: "At least 1 prior fixture for the team.",
      missingValuePolicy: "MISSING (null) for a team's first fixture in the dataset.",
      leakageRisk: "none",
      enabled: true,
    },
    {
      featureId: featureId(side, `matches_last_${CONGESTION_WINDOW_DAYS}_days`),
      name: `${teamLabel} matches in previous ${CONGESTION_WINDOW_DAYS} days`,
      version: 1,
      description: `Count of the ${teamLabel}'s fixtures with kickoff within ${CONGESTION_WINDOW_DAYS} days before this fixture's kickoff — a schedule-congestion indicator.`,
      family: FeatureFamily.REST_SCHEDULE,
      dataDependencies: ["fixtures"],
      lookback: `${CONGESTION_WINDOW_DAYS} days`,
      computationTimestampRule: "Only fixtures with scheduledKickoffAt strictly before this fixture's kickoff.",
      availabilityRequirement: "None — 0 is a legitimate, real count, always AVAILABLE.",
      missingValuePolicy: "Never MISSING; 0 is a real value here, not a placeholder for missing data.",
      leakageRisk: "none",
      enabled: true,
    },
  ];
});

async function computeSide(side: "home" | "away", ctx: FeatureComputationContext, deps: HistoryDependencies, teamId: string, beforeKickoff: string, sourceVersion: string): Promise<FeatureValue[]> {
  // Rest/congestion only need kickoff dates, not match results — read
  // fixtures directly rather than going through getTeamMatchHistory
  // (which narrows to matches with a known result, an irrelevant
  // restriction here: a match's schedule slot is known immediately,
  // long before its result is).
  const priorFixtures = await deps.fixtures.listForTeamBeforeKickoff(teamId, beforeKickoff);

  const daysSinceId = featureId(side, "days_since_previous_match");
  const congestionId = featureId(side, `matches_last_${CONGESTION_WINDOW_DAYS}_days`);

  if (priorFixtures.length === 0) {
    return [missingFeatureValue(daysSinceId, 1, ctx.fixtureId, ctx.snapshotTime, ctx.now, sourceVersion), { featureId: congestionId, featureVersion: 1, fixtureId: ctx.fixtureId, value: 0, computedAt: ctx.now, snapshotTime: ctx.snapshotTime, dataQuality: FeatureQuality.AVAILABLE, sourceVersion }];
  }

  const kickoffMs = new Date(beforeKickoff).getTime();
  const lastMatch = priorFixtures[priorFixtures.length - 1];
  const daysSince = (kickoffMs - new Date(lastMatch!.scheduledKickoffAt).getTime()) / (24 * 60 * 60 * 1000);

  const windowStartMs = kickoffMs - CONGESTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const matchesInWindow = priorFixtures.filter((f) => new Date(f.scheduledKickoffAt).getTime() >= windowStartMs).length;

  return [
    { featureId: daysSinceId, featureVersion: 1, fixtureId: ctx.fixtureId, value: daysSince, computedAt: ctx.now, snapshotTime: ctx.snapshotTime, dataQuality: FeatureQuality.AVAILABLE, sourceVersion },
    { featureId: congestionId, featureVersion: 1, fixtureId: ctx.fixtureId, value: matchesInWindow, computedAt: ctx.now, snapshotTime: ctx.snapshotTime, dataQuality: FeatureQuality.AVAILABLE, sourceVersion },
  ];
}

export async function computeRestScheduleFeatures(ctx: FeatureComputationContext, deps: HistoryDependencies, fixture: Fixture, sourceVersion: string): Promise<FeatureValue[]> {
  const [home, away] = await Promise.all([
    computeSide("home", ctx, deps, fixture.homeTeamId, fixture.scheduledKickoffAt, sourceVersion),
    computeSide("away", ctx, deps, fixture.awayTeamId, fixture.scheduledKickoffAt, sourceVersion),
  ]);
  return [...home, ...away];
}
