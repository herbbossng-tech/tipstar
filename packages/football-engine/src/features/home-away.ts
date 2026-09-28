import type { Fixture } from "../canonical.js";
import { getTeamMatchHistory, type HistoryDependencies, type HistoricalMatch, type TeamMatchHistory } from "./history.js";
import { summarizeForm, type FormSummary } from "./form.js";
import { FeatureFamily, missingFeatureValue, type FeatureComputationContext, type FeatureDefinition, type FeatureValue } from "./types.js";

/**
 * Home/Away — Section 05 §5.D ("team home performance", "team away
 * performance") and the same concept as §5.B's "home form"/"away form".
 * Reuses form.ts's summarizeForm() but restricted to only the matches a
 * team played at the relevant venue — the home team's performance
 * specifically in ITS home fixtures, the away team's specifically in
 * ITS away fixtures, since that is what's actually relevant to this
 * fixture (the home team is about to play at home; the away team is
 * about to play away).
 *
 * "Opponent-adjusted strength" (mentioned in the spec as "where
 * supported") is not implemented here — it would require a
 * strength-of-schedule model beyond plain Elo, which this section does
 * not build; Elo's rating difference (features/elo.ts) is the
 * opponent-aware signal this architecture actually provides.
 */

const VENUE_FORM_WINDOW_SIZE = 5;

function venueMatches(history: TeamMatchHistory, wantHome: boolean): TeamMatchHistory {
  const filtered: readonly HistoricalMatch[] = history.matches.filter((m) => m.isHome === wantHome);
  return { ...history, matches: filtered };
}

function featureId(side: "home" | "away", metric: string): string {
  return `${side}_team_venue_form_${metric}`;
}

export const HOME_AWAY_FEATURE_DEFINITIONS: readonly FeatureDefinition[] = (["home", "away"] as const).flatMap((side) => {
  const teamLabel = side === "home" ? "home team" : "away team";
  const venueLabel = side === "home" ? "home" : "away";
  return (["points_per_match", "goal_difference"] as const).map((metric) => ({
    featureId: featureId(side, metric),
    name: `${teamLabel} ${metric.replace(/_/g, " ")} in its own ${venueLabel} matches`,
    version: 1,
    description: `Rolling average over the ${teamLabel}'s last ${VENUE_FORM_WINDOW_SIZE} completed matches played at ${venueLabel} specifically — "how this team performs at ${venueLabel}", not overall form.`,
    family: FeatureFamily.HOME_AWAY,
    dataDependencies: ["fixtures", "match_results"],
    lookback: `last ${VENUE_FORM_WINDOW_SIZE} ${venueLabel} matches`,
    computationTimestampRule: "Only matches with scheduledKickoffAt before this fixture's kickoff AND resultRecordedAt <= snapshotTime, restricted to matches at this venue.",
    availabilityRequirement: `At least 1 prior ${venueLabel} match with a known result.`,
    missingValuePolicy: "MISSING (null) when the team has zero eligible prior matches at this venue.",
    leakageRisk: "low",
    enabled: true,
  }));
});

function toValues(side: "home" | "away", ctx: FeatureComputationContext, summary: FormSummary | undefined, sourceVersion: string): FeatureValue[] {
  const ppmId = featureId(side, "points_per_match");
  const gdId = featureId(side, "goal_difference");
  if (!summary) {
    return [missingFeatureValue(ppmId, 1, ctx.fixtureId, ctx.snapshotTime, ctx.now, sourceVersion), missingFeatureValue(gdId, 1, ctx.fixtureId, ctx.snapshotTime, ctx.now, sourceVersion)];
  }
  return [
    { featureId: ppmId, featureVersion: 1, fixtureId: ctx.fixtureId, value: summary.pointsPerMatch, computedAt: ctx.now, snapshotTime: ctx.snapshotTime, dataQuality: "AVAILABLE", sourceVersion },
    { featureId: gdId, featureVersion: 1, fixtureId: ctx.fixtureId, value: summary.goalDifferencePerMatch, computedAt: ctx.now, snapshotTime: ctx.snapshotTime, dataQuality: "AVAILABLE", sourceVersion },
  ];
}

export async function computeHomeAwayFeatures(ctx: FeatureComputationContext, deps: HistoryDependencies, fixture: Fixture, sourceVersion: string): Promise<FeatureValue[]> {
  const [homeHistory, awayHistory] = await Promise.all([
    getTeamMatchHistory(deps, fixture.homeTeamId, fixture.scheduledKickoffAt, ctx.snapshotTime),
    getTeamMatchHistory(deps, fixture.awayTeamId, fixture.scheduledKickoffAt, ctx.snapshotTime),
  ]);

  const homeVenueSummary = summarizeForm(venueMatches(homeHistory, true), VENUE_FORM_WINDOW_SIZE);
  const awayVenueSummary = summarizeForm(venueMatches(awayHistory, false), VENUE_FORM_WINDOW_SIZE);

  return [...toValues("home", ctx, homeVenueSummary, sourceVersion), ...toValues("away", ctx, awayVenueSummary, sourceVersion)];
}
