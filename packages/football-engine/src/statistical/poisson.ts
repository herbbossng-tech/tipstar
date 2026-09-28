import { ValidationError, err, ok, type Result } from "@sport-os/shared";
import type { Fixture } from "../canonical.js";
import { getGlobalMatchHistory, type GlobalHistoricalMatch, type HistoryDependencies } from "../features/history.js";
import type { ScorelineDistribution } from "../probability/types.js";

/**
 * Poisson statistical model — Section 05 §13.A. Classic attack/defense
 * strength formulation (Maher 1982): each team's goal-scoring rate is
 * expressed relative to the league average, split by venue (a team's
 * home attack strength is not assumed equal to its away attack
 * strength). Every input is drawn from the same leakage-safe global
 * history primitive (features/history.ts) every feature family uses —
 * this model reads no data feature computation couldn't also see.
 */

export function poissonPmf(k: number, lambda: number): number {
  if (k < 0 || !Number.isInteger(k) || lambda <= 0) return k === 0 && lambda === 0 ? 1 : 0;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

function factorial(n: number): number {
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

export interface GoalExpectations {
  readonly expectedHomeGoals: number;
  readonly expectedAwayGoals: number;
  readonly leagueAvgHomeGoals: number;
  readonly leagueAvgAwayGoals: number;
  readonly historicalMatchCount: number;
}

interface TeamStrength {
  readonly homeAttack: number;
  readonly homeDefense: number;
  readonly awayAttack: number;
  readonly awayDefense: number;
}

const NEUTRAL_STRENGTH = 1.0;
/** A strength product of exactly 0 (e.g. a team that has never conceded, or a defense strength of 0) would make expected goals 0 — legitimate in principle, but a Poisson distribution with lambda=0 collapses to a point mass at 0-0, which is too strong a claim from sparse data. Floored, not fabricated: this bounds a degenerate estimate, it does not invent a value where none exists (see estimateGoalExpectations's own INSUFFICIENT_HISTORICAL_DATA error for the true "no data" case). */
const MIN_EXPECTED_GOALS = 0.05;

function computeTeamStrength(matches: readonly GlobalHistoricalMatch[], teamId: string, leagueAvgHomeGoals: number, leagueAvgAwayGoals: number): TeamStrength {
  let homeGoalsFor = 0;
  let homeGoalsAgainst = 0;
  let homeMatchCount = 0;
  let awayGoalsFor = 0;
  let awayGoalsAgainst = 0;
  let awayMatchCount = 0;

  for (const { fixture, result } of matches) {
    if (fixture.homeTeamId === teamId) {
      homeGoalsFor += result.homeGoals;
      homeGoalsAgainst += result.awayGoals;
      homeMatchCount += 1;
    } else if (fixture.awayTeamId === teamId) {
      awayGoalsFor += result.awayGoals;
      awayGoalsAgainst += result.homeGoals;
      awayMatchCount += 1;
    }
  }

  return {
    homeAttack: homeMatchCount > 0 ? homeGoalsFor / homeMatchCount / leagueAvgHomeGoals : NEUTRAL_STRENGTH,
    homeDefense: homeMatchCount > 0 ? homeGoalsAgainst / homeMatchCount / leagueAvgAwayGoals : NEUTRAL_STRENGTH,
    awayAttack: awayMatchCount > 0 ? awayGoalsFor / awayMatchCount / leagueAvgAwayGoals : NEUTRAL_STRENGTH,
    awayDefense: awayMatchCount > 0 ? awayGoalsAgainst / awayMatchCount / leagueAvgHomeGoals : NEUTRAL_STRENGTH,
  };
}

/**
 * Estimates expected goals for `fixture` using only matches in the same
 * competition, with `scheduledKickoffAt < fixture.scheduledKickoffAt`
 * and a result known by `snapshotTime` — the same two-condition
 * leakage gate history.ts enforces everywhere else. Returns an explicit
 * error (never a fabricated league-average guess) when the competition
 * has zero such historical matches to estimate a league average from.
 */
export async function estimateGoalExpectations(deps: HistoryDependencies, fixture: Fixture, snapshotTime: string): Promise<Result<GoalExpectations, ValidationError>> {
  const allMatches = await getGlobalMatchHistory(deps, fixture.scheduledKickoffAt, snapshotTime);
  const matches = allMatches.filter((m) => m.fixture.competitionId === fixture.competitionId);

  if (matches.length === 0) {
    return err(new ValidationError({ message: "No historical matches in this competition known by snapshotTime — cannot estimate a league average.", code: "INSUFFICIENT_HISTORICAL_DATA", context: { fixtureId: fixture.id, competitionId: fixture.competitionId } }));
  }

  const totalHomeGoals = matches.reduce((sum, m) => sum + m.result.homeGoals, 0);
  const totalAwayGoals = matches.reduce((sum, m) => sum + m.result.awayGoals, 0);
  const leagueAvgHomeGoals = Math.max(totalHomeGoals / matches.length, MIN_EXPECTED_GOALS);
  const leagueAvgAwayGoals = Math.max(totalAwayGoals / matches.length, MIN_EXPECTED_GOALS);

  const homeStrength = computeTeamStrength(matches, fixture.homeTeamId, leagueAvgHomeGoals, leagueAvgAwayGoals);
  const awayStrength = computeTeamStrength(matches, fixture.awayTeamId, leagueAvgHomeGoals, leagueAvgAwayGoals);

  const expectedHomeGoals = Math.max(leagueAvgHomeGoals * homeStrength.homeAttack * awayStrength.awayDefense, MIN_EXPECTED_GOALS);
  const expectedAwayGoals = Math.max(leagueAvgAwayGoals * awayStrength.awayAttack * homeStrength.homeDefense, MIN_EXPECTED_GOALS);

  return ok({ expectedHomeGoals, expectedAwayGoals, leagueAvgHomeGoals, leagueAvgAwayGoals, historicalMatchCount: matches.length });
}

/**
 * Independent-Poisson joint scoreline distribution, truncated at
 * `maxGoals` per side and renormalized to sum to exactly 1 (the tail
 * beyond maxGoals carries negligible mass for realistic expected-goal
 * values, but truncation always leaves *some* mass unaccounted for —
 * renormalizing is standard practice, not a shortcut, and is what makes
 * this pass probability/consistency.ts's sum-to-1 check).
 */
export function buildPoissonScorelineDistribution(expectedHomeGoals: number, expectedAwayGoals: number, maxGoals = 10): ScorelineDistribution {
  const raw: { homeGoals: number; awayGoals: number; probability: number }[] = [];
  let total = 0;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = poissonPmf(h, expectedHomeGoals) * poissonPmf(a, expectedAwayGoals);
      raw.push({ homeGoals: h, awayGoals: a, probability: p });
      total += p;
    }
  }
  return raw.map((s) => ({ ...s, probability: s.probability / total }));
}
