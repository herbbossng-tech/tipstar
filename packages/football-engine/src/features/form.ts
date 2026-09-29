import type { Fixture } from "../canonical.js";
import type { HistoryDependencies } from "./history.js";
import { getTeamMatchHistory, matchOutcomeForTeam, teamGoalsAgainst, teamGoalsFor, type TeamMatchHistory } from "./history.js";
import { FeatureFamily, FeatureQuality, missingFeatureValue, type FeatureComputationContext, type FeatureDefinition, type FeatureValue } from "./types.js";

/**
 * Form + rolling Goals — Section 05 §5.B and §5.E. Both read the same
 * underlying rolling window of a team's most recent completed matches
 * (any venue), so they are computed together here rather than as two
 * files duplicating the same windowing logic. "Home form"/"away form"
 * (matches restricted to one venue) live in home-away.ts instead, since
 * they answer a different question ("how does this team do specifically
 * at home/away") from "how has this team done recently regardless of
 * venue" here.
 *
 * All rolling windows explicitly exclude the target fixture itself and
 * any future match — see history.ts's getTeamMatchHistory, the only
 * source of matches this file reads.
 */

export const FORM_WINDOW_SIZE = 5;

export interface FormSummary {
  readonly matchesConsidered: number;
  readonly pointsPerMatch: number;
  readonly goalsScoredPerMatch: number;
  readonly goalsConcededPerMatch: number;
  readonly goalDifferencePerMatch: number;
}

/** Pure function over an already-fetched TeamMatchHistory — kept separate from I/O so it's trivially unit-testable. */
export function summarizeForm(history: TeamMatchHistory, windowSize: number): FormSummary | undefined {
  const window = history.matches.slice(-windowSize);
  if (window.length === 0) return undefined;

  let points = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  for (const match of window) {
    const outcome = matchOutcomeForTeam(match);
    points += outcome === "win" ? 3 : outcome === "draw" ? 1 : 0;
    goalsFor += teamGoalsFor(match);
    goalsAgainst += teamGoalsAgainst(match);
  }

  return {
    matchesConsidered: window.length,
    pointsPerMatch: points / window.length,
    goalsScoredPerMatch: goalsFor / window.length,
    goalsConcededPerMatch: goalsAgainst / window.length,
    goalDifferencePerMatch: (goalsFor - goalsAgainst) / window.length,
  };
}

function featureId(side: "home" | "away", metric: string): string {
  return `${side}_team_form_${metric}_last${FORM_WINDOW_SIZE}`;
}

function definitionsForSide(side: "home" | "away"): readonly FeatureDefinition[] {
  const teamLabel = side === "home" ? "home team" : "away team";
  const metrics: ReadonlyArray<{ metric: string; name: string }> = [
    { metric: "points_per_match", name: `${teamLabel} points per match (form)` },
    { metric: "goals_scored", name: `${teamLabel} goals scored per match (form)` },
    { metric: "goals_conceded", name: `${teamLabel} goals conceded per match (form)` },
    { metric: "goal_difference", name: `${teamLabel} goal difference per match (form)` },
  ];
  return metrics.map(({ metric, name }) => ({
    featureId: featureId(side, metric),
    name,
    version: 1,
    description: `Rolling average over the ${teamLabel}'s last ${FORM_WINDOW_SIZE} completed matches (any venue), excluding the target fixture and any future match.`,
    family: FeatureFamily.FORM,
    dataDependencies: ["fixtures", "match_results"],
    lookback: `last ${FORM_WINDOW_SIZE} matches`,
    computationTimestampRule: "Only matches with scheduledKickoffAt before this fixture's kickoff AND resultRecordedAt <= snapshotTime.",
    availabilityRequirement: "At least 1 prior completed match with a known result.",
    missingValuePolicy: "MISSING (null) when the team has zero eligible prior matches — never defaulted to 0.",
    leakageRisk: "low",
    enabled: true,
  }));
}

export const FORM_FEATURE_DEFINITIONS: readonly FeatureDefinition[] = [...definitionsForSide("home"), ...definitionsForSide("away")];

function toFeatureValues(side: "home" | "away", ctx: FeatureComputationContext, summary: FormSummary | undefined, sourceVersion: string): FeatureValue[] {
  const metrics: ReadonlyArray<{ metric: string; value: number | undefined }> = summary
    ? [
        { metric: "points_per_match", value: summary.pointsPerMatch },
        { metric: "goals_scored", value: summary.goalsScoredPerMatch },
        { metric: "goals_conceded", value: summary.goalsConcededPerMatch },
        { metric: "goal_difference", value: summary.goalDifferencePerMatch },
      ]
    : [
        { metric: "points_per_match", value: undefined },
        { metric: "goals_scored", value: undefined },
        { metric: "goals_conceded", value: undefined },
        { metric: "goal_difference", value: undefined },
      ];

  return metrics.map(({ metric, value }) => {
    const id = featureId(side, metric);
    if (value === undefined) return missingFeatureValue(id, 1, ctx.fixtureId, ctx.snapshotTime, ctx.now, sourceVersion);
    return { featureId: id, featureVersion: 1, fixtureId: ctx.fixtureId, value, computedAt: ctx.now, snapshotTime: ctx.snapshotTime, dataQuality: FeatureQuality.AVAILABLE, sourceVersion };
  });
}

export async function computeFormFeatures(ctx: FeatureComputationContext, deps: HistoryDependencies, fixture: Fixture, sourceVersion: string): Promise<FeatureValue[]> {
  const [homeHistory, awayHistory] = await Promise.all([
    getTeamMatchHistory(deps, fixture.homeTeamId, fixture.scheduledKickoffAt, ctx.snapshotTime),
    getTeamMatchHistory(deps, fixture.awayTeamId, fixture.scheduledKickoffAt, ctx.snapshotTime),
  ]);

  return [...toFeatureValues("home", ctx, summarizeForm(homeHistory, FORM_WINDOW_SIZE), sourceVersion), ...toFeatureValues("away", ctx, summarizeForm(awayHistory, FORM_WINDOW_SIZE), sourceVersion)];
}
