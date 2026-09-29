import type { Fixture } from "../canonical.js";
import { FeatureFamily, FeatureQuality, type FeatureComputationContext, type FeatureDefinition, type FeatureValue } from "./types.js";

/**
 * Feature families this section deliberately does NOT compute, because
 * no canonical data source supports them yet — see
 * docs/architecture/FOOTBALL_INTELLIGENCE.md's capability matrix.
 *
 * Each is still declared as a FeatureDefinition (`enabled: false`) so:
 *  1. later sections/consumers have a stable name/shape to target the
 *     moment a real provider supplies the underlying data, and
 *  2. computing them always returns MISSING with a null value — never a
 *     fabricated number, and never goals silently relabeled as xG.
 *
 * xG (§5.F): "If xG is unavailable: do not fabricate xG, do not
 * substitute goals while naming the feature xG, mark xG features
 * unavailable." Team Statistics (§5.G) and Standings (§5.H): no
 * `team_observations` row of the relevant `observationType` has ever
 * been ingested (Section 04 OPEN_QUESTIONS.md #12) — nothing to read.
 */

export const XG_HOME_FEATURE_ID = "xg_expected_goals_home";
export const XG_AWAY_FEATURE_ID = "xg_expected_goals_away";
export const TEAM_STATS_SHOTS_ON_TARGET_HOME_FEATURE_ID = "team_stats_shots_on_target_home";
export const TEAM_STATS_SHOTS_ON_TARGET_AWAY_FEATURE_ID = "team_stats_shots_on_target_away";
export const STANDINGS_POSITION_DIFF_FEATURE_ID = "standings_position_difference";
export const STANDINGS_POINTS_PER_MATCH_DIFF_FEATURE_ID = "standings_points_per_match_difference";

function unavailableDefinition(featureId: string, name: string, family: FeatureFamily, description: string): FeatureDefinition {
  return {
    featureId,
    name,
    version: 1,
    description,
    family,
    dataDependencies: ["team_observations (not populated by any connected provider)"],
    lookback: "n/a",
    computationTimestampRule: "n/a — never computed; always returns MISSING.",
    availabilityRequirement: "A provider supplying this data has not been connected — see FOOTBALL_DATA_ARCHITECTURE.md.",
    missingValuePolicy: "Always MISSING (null). Never fabricated, never substituted from a related-but-different field.",
    leakageRisk: "none",
    enabled: false,
  };
}

export const UNAVAILABLE_FEATURE_DEFINITIONS: readonly FeatureDefinition[] = [
  unavailableDefinition(XG_HOME_FEATURE_ID, "Home team expected goals (xG)", FeatureFamily.XG, "No xG field exists anywhere in the Section 04 canonical model. Never computed from goals."),
  unavailableDefinition(XG_AWAY_FEATURE_ID, "Away team expected goals (xG)", FeatureFamily.XG, "Same as xg_expected_goals_home."),
  unavailableDefinition(TEAM_STATS_SHOTS_ON_TARGET_HOME_FEATURE_ID, "Home team shots on target", FeatureFamily.TEAM_STATISTICS, "No team_observations rows of this type have ever been ingested by any connected provider."),
  unavailableDefinition(TEAM_STATS_SHOTS_ON_TARGET_AWAY_FEATURE_ID, "Away team shots on target", FeatureFamily.TEAM_STATISTICS, "Same as team_stats_shots_on_target_home."),
  unavailableDefinition(STANDINGS_POSITION_DIFF_FEATURE_ID, "League table position difference", FeatureFamily.STANDINGS, "No standings observation has ever been ingested by any connected provider."),
  unavailableDefinition(STANDINGS_POINTS_PER_MATCH_DIFF_FEATURE_ID, "League table points-per-match difference", FeatureFamily.STANDINGS, "Same as standings_position_difference."),
];

/** Always returns MISSING for every declared-but-disabled feature — a deliberate, explicit stand-in, never silently omitted from the vector. */
export function computeUnavailableFeatures(ctx: FeatureComputationContext, _fixture: Fixture, sourceVersion: string): FeatureValue[] {
  return UNAVAILABLE_FEATURE_DEFINITIONS.map((def) => ({
    featureId: def.featureId,
    featureVersion: def.version,
    fixtureId: ctx.fixtureId,
    value: null,
    computedAt: ctx.now,
    snapshotTime: ctx.snapshotTime,
    dataQuality: FeatureQuality.MISSING,
    sourceVersion,
  }));
}
