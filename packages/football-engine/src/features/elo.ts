import type { UUID } from "@sport-os/shared";
import type { Fixture } from "../canonical.js";
import type { FixturesRepository, MatchResultsRepository } from "../repositories/fixtures.js";
import { getGlobalMatchHistory, type GlobalHistoricalMatch } from "./history.js";
import { FeatureFamily, FeatureQuality, type FeatureComputationContext, type FeatureDefinition, type FeatureValue } from "./types.js";

/**
 * Team Strength (Elo) — Section 05 §5.A. Elo cannot be computed from one
 * team's own match history in isolation: a team's rating depends
 * transitively on every opponent it has played (whose ratings depend on
 * their own histories in turn), so this replays EVERY match globally, in
 * strict chronological order, updating both teams' ratings after each
 * one. A team's post-match rating is only ever visible to fixtures whose
 * kickoff is strictly after that match — see history.ts's
 * getGlobalMatchHistory, which this is built on.
 */

export const DEFAULT_ELO_RATING = 1500;
/** A single constant K-factor, not varied by competition importance — a documented scope decision (see docs/architecture/FOOTBALL_INTELLIGENCE.md), not "the" correct K-factor. */
export const ELO_K_FACTOR = 20;
/** Added to the home team's rating for the *expected-score* calculation only — never persisted into the stored rating itself. */
export const ELO_HOME_ADVANTAGE = 100;

export function eloExpectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Replays `matches` (must already be in ascending chronological order —
 * getGlobalMatchHistory guarantees this) and returns every team's final
 * rating. A team with no prior matches is DEFAULT_ELO_RATING, never
 * null/undefined — an untested team is a legitimate Elo state (the
 * "cold start" problem), not missing data.
 */
export function replayEloRatings(matches: readonly GlobalHistoricalMatch[]): ReadonlyMap<UUID, number> {
  const ratings = new Map<UUID, number>();
  const getRating = (teamId: UUID): number => ratings.get(teamId) ?? DEFAULT_ELO_RATING;

  for (const { fixture, result } of matches) {
    const homeRating = getRating(fixture.homeTeamId);
    const awayRating = getRating(fixture.awayTeamId);

    const expectedHome = eloExpectedScore(homeRating + ELO_HOME_ADVANTAGE, awayRating);
    const expectedAway = 1 - expectedHome;

    let actualHome: number;
    let actualAway: number;
    if (result.homeGoals > result.awayGoals) {
      actualHome = 1;
      actualAway = 0;
    } else if (result.homeGoals < result.awayGoals) {
      actualHome = 0;
      actualAway = 1;
    } else {
      actualHome = 0.5;
      actualAway = 0.5;
    }

    ratings.set(fixture.homeTeamId, homeRating + ELO_K_FACTOR * (actualHome - expectedHome));
    ratings.set(fixture.awayTeamId, awayRating + ELO_K_FACTOR * (actualAway - expectedAway));
  }

  return ratings;
}

export interface EloDependencies {
  readonly fixtures: FixturesRepository;
  readonly matchResults: MatchResultsRepository;
}

/** Fetches the global chronological history up to `fixture`'s kickoff and replays it — the one entry point feature computation and the Elo baseline model (models/elo-baseline.ts) both call. */
export async function computeEloRatingsBeforeFixture(deps: EloDependencies, fixture: Fixture, snapshotTime: string): Promise<ReadonlyMap<UUID, number>> {
  const matches = await getGlobalMatchHistory(deps, fixture.scheduledKickoffAt, snapshotTime);
  return replayEloRatings(matches);
}

export const ELO_RATING_HOME_FEATURE_ID = "elo_rating_home";
export const ELO_RATING_AWAY_FEATURE_ID = "elo_rating_away";
export const ELO_RATING_DIFF_FEATURE_ID = "elo_rating_diff";

export const ELO_FEATURE_DEFINITIONS: readonly FeatureDefinition[] = [
  {
    featureId: ELO_RATING_HOME_FEATURE_ID,
    name: "Home team Elo rating",
    version: 1,
    description: "The home team's Elo rating as of the snapshot, from a global chronological replay of every completed match known by that snapshot.",
    family: FeatureFamily.TEAM_STRENGTH,
    dataDependencies: ["fixtures", "match_results"],
    lookback: "full history",
    computationTimestampRule: "Replays only fixtures with scheduledKickoffAt < this fixture's kickoff, and only match results with resultRecordedAt <= snapshotTime.",
    availabilityRequirement: "None — a team with no prior history gets the default rating (1500), which is itself a legitimate Elo state, not a missing value.",
    missingValuePolicy: "Never MISSING for a valid fixture/snapshot; always AVAILABLE.",
    leakageRisk: "low",
    enabled: true,
  },
  {
    featureId: ELO_RATING_AWAY_FEATURE_ID,
    name: "Away team Elo rating",
    version: 1,
    description: "The away team's Elo rating as of the snapshot — see elo_rating_home.",
    family: FeatureFamily.TEAM_STRENGTH,
    dataDependencies: ["fixtures", "match_results"],
    lookback: "full history",
    computationTimestampRule: "Same as elo_rating_home.",
    availabilityRequirement: "None.",
    missingValuePolicy: "Never MISSING for a valid fixture/snapshot; always AVAILABLE.",
    leakageRisk: "low",
    enabled: true,
  },
  {
    featureId: ELO_RATING_DIFF_FEATURE_ID,
    name: "Elo rating difference (home - away)",
    version: 1,
    description: "elo_rating_home minus elo_rating_away — the single most model-useful summary of relative team strength.",
    family: FeatureFamily.TEAM_STRENGTH,
    dataDependencies: ["fixtures", "match_results"],
    lookback: "full history",
    computationTimestampRule: "Same as elo_rating_home.",
    availabilityRequirement: "None.",
    missingValuePolicy: "Never MISSING for a valid fixture/snapshot; always AVAILABLE.",
    leakageRisk: "low",
    enabled: true,
  },
];

export async function computeEloFeatures(ctx: FeatureComputationContext, deps: EloDependencies, fixture: Fixture, sourceVersion: string): Promise<FeatureValue[]> {
  const ratings = await computeEloRatingsBeforeFixture(deps, fixture, ctx.snapshotTime);
  const homeRating = ratings.get(fixture.homeTeamId) ?? DEFAULT_ELO_RATING;
  const awayRating = ratings.get(fixture.awayTeamId) ?? DEFAULT_ELO_RATING;

  const value = (featureId: string, featureVersion: number, v: number): FeatureValue => ({
    featureId,
    featureVersion,
    fixtureId: ctx.fixtureId,
    value: v,
    computedAt: ctx.now,
    snapshotTime: ctx.snapshotTime,
    dataQuality: FeatureQuality.AVAILABLE,
    sourceVersion,
  });

  return [
    value(ELO_RATING_HOME_FEATURE_ID, 1, homeRating),
    value(ELO_RATING_AWAY_FEATURE_ID, 1, awayRating),
    value(ELO_RATING_DIFF_FEATURE_ID, 1, homeRating - awayRating),
  ];
}
