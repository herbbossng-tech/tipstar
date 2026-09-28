import type { Fixture, OddsObservation } from "../canonical.js";
import type { OddsObservationsRepository } from "../repositories/observations.js";
import { FeatureFamily, FeatureQuality, type FeatureComputationContext, type FeatureDefinition, type FeatureValue } from "./types.js";

/**
 * Odds features — Section 05 §5.J. Reads only
 * OddsObservationsRepository.listForFixtureAsOf(fixtureId, snapshotTime)
 * — the exact Section 04 point-in-time-safe read — so every value here
 * is already bounded to what was observed at or before this snapshot.
 * Never reads "closing odds": since every feature snapshot in this
 * section is pre-match, the *latest observation at or before
 * snapshotTime* already stands in for "most recent known price", and a
 * true post-close value could never legitimately appear in a pre-match
 * snapshot anyway — see docs/architecture/FOOTBALL_INTELLIGENCE.md's
 * capability matrix, "Odds closing values" row.
 */

export const MATCH_RESULT_1X2_MARKET = "match_result_1x2";
export const SELECTION_HOME = "home";
export const SELECTION_DRAW = "draw";
export const SELECTION_AWAY = "away";

export const ODDS_IMPLIED_PROB_HOME_FEATURE_ID = "odds_implied_probability_home";
export const ODDS_IMPLIED_PROB_DRAW_FEATURE_ID = "odds_implied_probability_draw";
export const ODDS_IMPLIED_PROB_AWAY_FEATURE_ID = "odds_implied_probability_away";
export const ODDS_OVERROUND_FEATURE_ID = "odds_overround";
export const ODDS_OPENING_IMPLIED_PROB_HOME_FEATURE_ID = "odds_opening_implied_probability_home";
export const ODDS_PROBABILITY_MOVEMENT_HOME_FEATURE_ID = "odds_probability_movement_home";

function definition(featureId: string, name: string, description: string): FeatureDefinition {
  return {
    featureId,
    name,
    version: 1,
    description,
    family: FeatureFamily.ODDS,
    dataDependencies: ["odds_observations"],
    lookback: "all pre-snapshot observations for this fixture's 1X2 market",
    computationTimestampRule: "Reads only OddsObservationsRepository.listForFixtureAsOf(fixtureId, snapshotTime) — every observation already satisfies observedAt <= snapshotTime.",
    availabilityRequirement: "At least 1 observation on the match_result_1x2 market for the relevant selection(s).",
    missingValuePolicy: "MISSING (null) when no qualifying observation exists as of this snapshot.",
    leakageRisk: "low",
    enabled: true,
  };
}

export const ODDS_FEATURE_DEFINITIONS: readonly FeatureDefinition[] = [
  definition(ODDS_IMPLIED_PROB_HOME_FEATURE_ID, "Latest implied probability — home win", "1 / latest pre-snapshot home-selection price on the 1X2 market, raw (not overround-adjusted)."),
  definition(ODDS_IMPLIED_PROB_DRAW_FEATURE_ID, "Latest implied probability — draw", "1 / latest pre-snapshot draw-selection price on the 1X2 market, raw."),
  definition(ODDS_IMPLIED_PROB_AWAY_FEATURE_ID, "Latest implied probability — away win", "1 / latest pre-snapshot away-selection price on the 1X2 market, raw."),
  definition(ODDS_OVERROUND_FEATURE_ID, "Market overround", "Sum of the three raw implied probabilities minus 1 — the bookmaker's built-in margin. Requires all three selections to have an observation."),
  definition(ODDS_OPENING_IMPLIED_PROB_HOME_FEATURE_ID, "Opening implied probability — home win", "1 / the EARLIEST pre-snapshot home-selection price observed for this fixture — never a true market \"opening\" price if that predates when observation began, only the earliest one this system has seen."),
  definition(ODDS_PROBABILITY_MOVEMENT_HOME_FEATURE_ID, "Home win probability movement", "Latest home implied probability minus opening home implied probability — positive means the market has moved toward the home team since the earliest observation."),
];

function latestBySelection(observations: readonly OddsObservation[], selection: string): OddsObservation | undefined {
  const matches = observations.filter((o) => o.marketType === MATCH_RESULT_1X2_MARKET && o.selection === selection);
  if (matches.length === 0) return undefined;
  return [...matches].sort((a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime())[matches.length - 1];
}

function earliestBySelection(observations: readonly OddsObservation[], selection: string): OddsObservation | undefined {
  const matches = observations.filter((o) => o.marketType === MATCH_RESULT_1X2_MARKET && o.selection === selection);
  if (matches.length === 0) return undefined;
  return [...matches].sort((a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime())[0];
}

function impliedProbability(odds: number): number {
  return 1 / odds;
}

export interface OddsFeatureDependencies {
  readonly oddsObservations: OddsObservationsRepository;
}

export async function computeOddsFeatures(ctx: FeatureComputationContext, deps: OddsFeatureDependencies, fixture: Fixture, sourceVersion: string): Promise<FeatureValue[]> {
  const observations = await deps.oddsObservations.listForFixtureAsOf(fixture.id, ctx.snapshotTime);

  const value = (featureId: string, v: number | null, quality: FeatureQuality = FeatureQuality.AVAILABLE): FeatureValue => ({
    featureId,
    featureVersion: 1,
    fixtureId: ctx.fixtureId,
    value: v,
    computedAt: ctx.now,
    snapshotTime: ctx.snapshotTime,
    dataQuality: v === null ? FeatureQuality.MISSING : quality,
    sourceVersion,
  });

  const latestHome = latestBySelection(observations, SELECTION_HOME);
  const latestDraw = latestBySelection(observations, SELECTION_DRAW);
  const latestAway = latestBySelection(observations, SELECTION_AWAY);
  const openingHome = earliestBySelection(observations, SELECTION_HOME);

  const homeProb = latestHome ? impliedProbability(latestHome.odds) : null;
  const drawProb = latestDraw ? impliedProbability(latestDraw.odds) : null;
  const awayProb = latestAway ? impliedProbability(latestAway.odds) : null;
  const openingHomeProb = openingHome ? impliedProbability(openingHome.odds) : null;

  const results: FeatureValue[] = [
    value(ODDS_IMPLIED_PROB_HOME_FEATURE_ID, homeProb),
    value(ODDS_IMPLIED_PROB_DRAW_FEATURE_ID, drawProb),
    value(ODDS_IMPLIED_PROB_AWAY_FEATURE_ID, awayProb),
    value(ODDS_OVERROUND_FEATURE_ID, homeProb !== null && drawProb !== null && awayProb !== null ? homeProb + drawProb + awayProb - 1 : null),
    value(ODDS_OPENING_IMPLIED_PROB_HOME_FEATURE_ID, openingHomeProb),
    value(ODDS_PROBABILITY_MOVEMENT_HOME_FEATURE_ID, homeProb !== null && openingHomeProb !== null ? homeProb - openingHomeProb : null),
  ];

  if (latestHome?.temporalReliability === "estimated" || latestDraw?.temporalReliability === "estimated" || latestAway?.temporalReliability === "estimated") {
    // Surfaced via LOW_CONFIDENCE rather than silently treating an
    // estimated-reliability price the same as a provider-confirmed one.
    return results.map((v) => (v.dataQuality === FeatureQuality.AVAILABLE ? { ...v, dataQuality: FeatureQuality.LOW_CONFIDENCE } : v));
  }
  return results;
}
