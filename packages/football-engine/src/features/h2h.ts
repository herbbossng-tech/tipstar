import type { Fixture } from "../canonical.js";
import { getTeamMatchHistory, matchOutcomeForTeam, teamGoalsAgainst, teamGoalsFor, type HistoryDependencies } from "./history.js";
import { FeatureFamily, FeatureQuality, type FeatureComputationContext, type FeatureDefinition, type FeatureValue } from "./types.js";

/**
 * Head-to-Head — Section 05 §5.I. Treated cautiously per the spec:
 * "Do not allow H2H to dominate merely because it is easy to compute."
 * Below MIN_FOR_LOW_CONFIDENCE meetings, features report MISSING; below
 * MIN_FOR_AVAILABLE (but at least MIN_FOR_LOW_CONFIDENCE), they report a
 * real value but flagged LOW_CONFIDENCE rather than AVAILABLE, so a
 * consumer (dataset builder, model) can choose to discount or exclude
 * them rather than treating one previous meeting as a reliable signal.
 *
 * Reuses getTeamMatchHistory (the home team's full history) and simply
 * filters to meetings against the away team — no new leakage surface:
 * every meeting found this way already passed the same
 * kickoff-before/result-known-by-snapshot gate every other family uses.
 */

const MIN_FOR_LOW_CONFIDENCE = 1;
const MIN_FOR_AVAILABLE = 3;
const H2H_LOOKBACK_MATCHES = 10;

export const H2H_HOME_WIN_RATE_FEATURE_ID = "h2h_home_team_win_rate";
export const H2H_AVERAGE_TOTAL_GOALS_FEATURE_ID = "h2h_average_total_goals";
export const H2H_MATCHES_COUNT_FEATURE_ID = "h2h_matches_considered_count";

export const H2H_FEATURE_DEFINITIONS: readonly FeatureDefinition[] = [
  {
    featureId: H2H_HOME_WIN_RATE_FEATURE_ID,
    name: "Head-to-head home team win rate",
    version: 1,
    description: `Share of the last ${H2H_LOOKBACK_MATCHES} prior meetings between these two teams (any venue) won by the team that is home in this fixture.`,
    family: FeatureFamily.HEAD_TO_HEAD,
    dataDependencies: ["fixtures", "match_results"],
    lookback: `last ${H2H_LOOKBACK_MATCHES} meetings`,
    computationTimestampRule: "Only meetings with scheduledKickoffAt before this fixture's kickoff AND resultRecordedAt <= snapshotTime.",
    availabilityRequirement: `At least ${MIN_FOR_LOW_CONFIDENCE} prior meeting for LOW_CONFIDENCE, at least ${MIN_FOR_AVAILABLE} for AVAILABLE.`,
    missingValuePolicy: "MISSING (null) with zero prior meetings — never assumed 50/50 or any other default.",
    leakageRisk: "low",
    enabled: true,
  },
  {
    featureId: H2H_AVERAGE_TOTAL_GOALS_FEATURE_ID,
    name: "Head-to-head average total goals",
    version: 1,
    description: "Average combined goals (both teams) across the same meeting set as h2h_home_team_win_rate.",
    family: FeatureFamily.HEAD_TO_HEAD,
    dataDependencies: ["fixtures", "match_results"],
    lookback: `last ${H2H_LOOKBACK_MATCHES} meetings`,
    computationTimestampRule: "Same as h2h_home_team_win_rate.",
    availabilityRequirement: `At least ${MIN_FOR_LOW_CONFIDENCE} prior meeting for LOW_CONFIDENCE, at least ${MIN_FOR_AVAILABLE} for AVAILABLE.`,
    missingValuePolicy: "MISSING (null) with zero prior meetings.",
    leakageRisk: "low",
    enabled: true,
  },
  {
    featureId: H2H_MATCHES_COUNT_FEATURE_ID,
    name: "Head-to-head meetings considered",
    version: 1,
    description: "How many prior meetings the two features above were computed from — lets a consumer apply its own confidence discount independent of the LOW_CONFIDENCE/AVAILABLE split.",
    family: FeatureFamily.HEAD_TO_HEAD,
    dataDependencies: ["fixtures", "match_results"],
    lookback: `last ${H2H_LOOKBACK_MATCHES} meetings`,
    computationTimestampRule: "Same as h2h_home_team_win_rate.",
    availabilityRequirement: "None — 0 is itself informative and always AVAILABLE.",
    missingValuePolicy: "Never MISSING.",
    leakageRisk: "none",
    enabled: true,
  },
];

export async function computeH2hFeatures(ctx: FeatureComputationContext, deps: HistoryDependencies, fixture: Fixture, sourceVersion: string): Promise<FeatureValue[]> {
  const homeHistory = await getTeamMatchHistory(deps, fixture.homeTeamId, fixture.scheduledKickoffAt, ctx.snapshotTime);
  const meetings = homeHistory.matches.filter((m) => (m.isHome ? m.fixture.awayTeamId : m.fixture.homeTeamId) === fixture.awayTeamId).slice(-H2H_LOOKBACK_MATCHES);

  const count = meetings.length;
  const countValue: FeatureValue = { featureId: H2H_MATCHES_COUNT_FEATURE_ID, featureVersion: 1, fixtureId: ctx.fixtureId, value: count, computedAt: ctx.now, snapshotTime: ctx.snapshotTime, dataQuality: FeatureQuality.AVAILABLE, sourceVersion };

  if (count < MIN_FOR_LOW_CONFIDENCE) {
    return [
      countValue,
      { featureId: H2H_HOME_WIN_RATE_FEATURE_ID, featureVersion: 1, fixtureId: ctx.fixtureId, value: null, computedAt: ctx.now, snapshotTime: ctx.snapshotTime, dataQuality: FeatureQuality.MISSING, sourceVersion },
      { featureId: H2H_AVERAGE_TOTAL_GOALS_FEATURE_ID, featureVersion: 1, fixtureId: ctx.fixtureId, value: null, computedAt: ctx.now, snapshotTime: ctx.snapshotTime, dataQuality: FeatureQuality.MISSING, sourceVersion },
    ];
  }

  let homeWins = 0;
  let totalGoals = 0;
  for (const meeting of meetings) {
    if (matchOutcomeForTeam(meeting) === "win") homeWins += 1;
    totalGoals += teamGoalsFor(meeting) + teamGoalsAgainst(meeting);
  }

  const quality = count < MIN_FOR_AVAILABLE ? FeatureQuality.LOW_CONFIDENCE : FeatureQuality.AVAILABLE;

  return [
    countValue,
    { featureId: H2H_HOME_WIN_RATE_FEATURE_ID, featureVersion: 1, fixtureId: ctx.fixtureId, value: homeWins / count, computedAt: ctx.now, snapshotTime: ctx.snapshotTime, dataQuality: quality, sourceVersion },
    { featureId: H2H_AVERAGE_TOTAL_GOALS_FEATURE_ID, featureVersion: 1, fixtureId: ctx.fixtureId, value: totalGoals / count, computedAt: ctx.now, snapshotTime: ctx.snapshotTime, dataQuality: quality, sourceVersion },
  ];
}
