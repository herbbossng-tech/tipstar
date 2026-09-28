import { ValidationError, err, ok, type Result } from "@sport-os/shared";
import type { Fixture } from "./canonical.js";
import { DEFAULT_ELO_RATING, ELO_HOME_ADVANTAGE, computeEloRatingsBeforeFixture, eloExpectedScore, type EloDependencies } from "./features/elo.js";
import { getGlobalMatchHistory, type HistoryDependencies } from "./features/history.js";
import type { FeatureVector } from "./features/types.js";
import { derive1x2FromScoreline } from "./probability/scoreline.js";
import type { Probability1x2 } from "./probability/types.js";
import { buildPoissonScorelineDistribution, estimateGoalExpectations } from "./statistical/poisson.js";

/**
 * Baselines — Section 05 §10. Purpose: establish whether a complex
 * model actually adds predictive information over something simple —
 * "Do not declare a model superior without evaluation evidence." Every
 * baseline here is genuinely computed (or, for the naive one,
 * genuinely a fixed constant, clearly labeled as such) — none of them
 * are stand-ins for a model that was too hard to build.
 */

export interface BaselineResult {
  readonly name: string;
  readonly probability1x2: Probability1x2;
}

/** A. The textbook "no domain knowledge at all" baseline — equal probability for every outcome. Never claims to reflect real base rates (compare with historicalFrequencyBaseline, which does). */
export function naiveBaseline(): BaselineResult {
  return { name: "naive_equal", probability1x2: { home: 1 / 3, draw: 1 / 3, away: 1 / 3 } };
}

interface HistoricalOutcomeRates {
  readonly homeWinRate: number;
  readonly drawRate: number;
  readonly awayWinRate: number;
  readonly matchCount: number;
}

async function computeHistoricalOutcomeRates(deps: HistoryDependencies, fixture: Fixture, snapshotTime: string): Promise<Result<HistoricalOutcomeRates, ValidationError>> {
  const allMatches = await getGlobalMatchHistory(deps, fixture.scheduledKickoffAt, snapshotTime);
  const matches = allMatches.filter((m) => m.fixture.competitionId === fixture.competitionId);
  if (matches.length === 0) {
    return err(new ValidationError({ message: "No historical matches in this competition known by snapshotTime.", code: "INSUFFICIENT_HISTORICAL_DATA", context: { fixtureId: fixture.id } }));
  }
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  for (const { result } of matches) {
    if (result.homeGoals > result.awayGoals) homeWins += 1;
    else if (result.homeGoals < result.awayGoals) awayWins += 1;
    else draws += 1;
  }
  return ok({ homeWinRate: homeWins / matches.length, drawRate: draws / matches.length, awayWinRate: awayWins / matches.length, matchCount: matches.length });
}

/** C. The empirical historical-frequency prior — "how often did HOME/DRAW/AWAY actually happen in this competition's history known by this snapshot." */
export async function historicalFrequencyBaseline(deps: HistoryDependencies, fixture: Fixture, snapshotTime: string): Promise<Result<BaselineResult, ValidationError>> {
  const rates = await computeHistoricalOutcomeRates(deps, fixture, snapshotTime);
  if (!rates.ok) return rates;
  return ok({ name: "historical_frequency", probability1x2: { home: rates.value.homeWinRate, draw: rates.value.drawRate, away: rates.value.awayWinRate } });
}

/**
 * B. Elo baseline: the Elo expected-score formula only separates
 * "win-equivalent share" between the two teams — it has no native
 * notion of a draw. This baseline uses the same empirical draw rate as
 * historicalFrequencyBaseline for P(draw), then splits the remainder
 * between home/away proportional to the Elo win expectancy — a
 * standard, documented technique (the same shape used by several public
 * Elo-to-1X2 conversions), not an ad hoc invention.
 */
export async function eloBaseline(deps: EloDependencies, fixture: Fixture, snapshotTime: string): Promise<Result<BaselineResult, ValidationError>> {
  const rates = await computeHistoricalOutcomeRates(deps, fixture, snapshotTime);
  if (!rates.ok) return rates;

  const ratings = await computeEloRatingsBeforeFixture(deps, fixture, snapshotTime);
  const homeRating = ratings.get(fixture.homeTeamId) ?? DEFAULT_ELO_RATING;
  const awayRating = ratings.get(fixture.awayTeamId) ?? DEFAULT_ELO_RATING;
  const winExpectancy = eloExpectedScore(homeRating + ELO_HOME_ADVANTAGE, awayRating);

  const pDraw = rates.value.drawRate;
  const pHome = (1 - pDraw) * winExpectancy;
  const pAway = (1 - pDraw) * (1 - winExpectancy);
  return ok({ name: "elo", probability1x2: { home: pHome, draw: pDraw, away: pAway } });
}

/** E (optional). Poisson baseline — thin glue over statistical/poisson.ts, included because the marginal cost is one function call once the statistical engine exists. */
export async function poissonBaseline(deps: HistoryDependencies, fixture: Fixture, snapshotTime: string): Promise<Result<BaselineResult, ValidationError>> {
  const expectations = await estimateGoalExpectations(deps, fixture, snapshotTime);
  if (!expectations.ok) return expectations;
  const distribution = buildPoissonScorelineDistribution(expectations.value.expectedHomeGoals, expectations.value.expectedAwayGoals);
  return ok({ name: "poisson", probability1x2: derive1x2FromScoreline(distribution) });
}

/**
 * D. Market-implied baseline — ONLY computed when trustworthy
 * point-in-time historical odds exist (features/odds.ts's three
 * odds_implied_probability_* features, all AVAILABLE). Removes the
 * bookmaker's overround via proportional normalization (dividing each
 * raw implied probability by their sum) — a standard, explicitly
 * documented "fair probability" approximation, not a claim that this
 * recovers the bookmaker's true internal model.
 */
export function marketImpliedBaseline(features: FeatureVector): Result<BaselineResult, ValidationError> {
  const home = features.odds_implied_probability_home;
  const draw = features.odds_implied_probability_draw;
  const away = features.odds_implied_probability_away;
  if (!home || !draw || !away || home.value === null || draw.value === null || away.value === null) {
    return err(new ValidationError({ message: "No trustworthy pre-snapshot 1X2 odds available — market-implied baseline requires all three selections.", code: "ODDS_UNAVAILABLE" }));
  }
  const sum = home.value + draw.value + away.value;
  return ok({ name: "market_implied", probability1x2: { home: home.value / sum, draw: draw.value / sum, away: away.value / sum } });
}
