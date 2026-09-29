import { ValidationError, ok, type Result } from "@sport-os/shared";
import type { Fixture } from "../canonical.js";
import { getGlobalMatchHistory, type GlobalHistoricalMatch, type HistoryDependencies } from "../features/history.js";
import type { ScorelineDistribution } from "../probability/types.js";
import { estimateGoalExpectations, poissonPmf } from "./poisson.js";

/**
 * Dixon-Coles adjustment — Section 05 §13.B (Dixon, M.J. and Coles, S.G.,
 * 1997, "Modelling Association Football Scores and Inefficiencies in
 * the Football Betting Market"). Corrects the plain-Poisson model's
 * known weakness: it underestimates the empirical frequency of
 * low-scoring results (0-0, 1-0, 0-1, and especially 1-1) because it
 * assumes home and away goals are independent, which real match data
 * does not fully support at low scores.
 *
 * This is a genuine implementation of the paper's τ (tau) correction
 * and time-weighting, with one documented simplification: ρ (rho) is
 * fit by a bounded grid-search maximizing the (time-weighted)
 * log-likelihood of historical results *using the final, static
 * attack/defense-derived expected goals* for every historical match,
 * rather than the paper's fully time-varying parameter re-estimation
 * at each historical point. That full re-estimation would mean
 * re-running the whole attack/defense fit once per historical match —
 * correct in principle, but a materially heavier computation this
 * section's scope does not require to genuinely implement the tau
 * methodology. This is a documented modeling simplification, not a
 * missing implementation — see docs/architecture/MODEL_VALIDATION.md.
 */

/** The exact 4-case τ correction from the paper. x/y must be non-negative integers. */
export function dixonColesTau(x: number, y: number, lambda: number, mu: number, rho: number): number {
  if (x === 0 && y === 0) return 1 - lambda * mu * rho;
  if (x === 0 && y === 1) return 1 + lambda * rho;
  if (x === 1 && y === 0) return 1 + mu * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

/** Exponential recency weight from the paper: more recent matches count more. `xi` (ξ) controls decay speed — 0 means no time-weighting (every match equal). */
export function dixonColesTimeWeight(daysSinceMatch: number, xi: number): number {
  if (xi <= 0) return 1;
  return Math.exp(-xi * daysSinceMatch);
}

function dixonColesJointProbability(x: number, y: number, lambda: number, mu: number, rho: number): number {
  return dixonColesTau(x, y, lambda, mu, rho) * poissonPmf(x, lambda) * poissonPmf(y, mu);
}

/**
 * Rescales expected goals into the same attack/defense terms
 * estimateGoalExpectations uses, applied to one historical match — the
 * "static parameter" simplification described above: every historical
 * match is scored using the SAME final league-average/attack/defense
 * figures the target fixture's own expected goals were computed from,
 * not a match-specific historical refit.
 */
function expectedGoalsForHistoricalMatch(match: GlobalHistoricalMatch, leagueAvgHomeGoals: number, leagueAvgAwayGoals: number, strengthByTeam: ReadonlyMap<string, { attack: number; defense: number; venue: "home" | "away" }>): { lambda: number; mu: number } | undefined {
  const home = strengthByTeam.get(`${match.fixture.homeTeamId}:home`);
  const away = strengthByTeam.get(`${match.fixture.awayTeamId}:away`);
  if (!home || !away) return undefined;
  return { lambda: Math.max(leagueAvgHomeGoals * home.attack * away.defense, 0.05), mu: Math.max(leagueAvgAwayGoals * away.attack * home.defense, 0.05) };
}

const RHO_GRID_MIN = -0.3;
const RHO_GRID_MAX = 0.3;
const RHO_GRID_STEP = 0.005;
const DEFAULT_TIME_DECAY_XI = 0; // no time-weighting by default — a documented, explicit opt-in via estimateDixonColesParameters's `xi` parameter, per "time weighting where appropriate" rather than always-on.

export interface DixonColesParameters {
  readonly expectedHomeGoals: number;
  readonly expectedAwayGoals: number;
  readonly rho: number;
  readonly historicalMatchCount: number;
}

/**
 * Fits ρ by (time-weighted) log-likelihood grid search over the
 * historical match set, then returns the target fixture's own expected
 * goals alongside it. Reuses estimateGoalExpectations for both the
 * target fixture's λ/μ and (via the same attack/defense formula) every
 * historical match's λ/μ for the rho fit — see the module comment for
 * why this is "static", not per-match-time-varying.
 */
export async function estimateDixonColesParameters(deps: HistoryDependencies, fixture: Fixture, snapshotTime: string, xi: number = DEFAULT_TIME_DECAY_XI): Promise<Result<DixonColesParameters, ValidationError>> {
  const goalExpectations = await estimateGoalExpectations(deps, fixture, snapshotTime);
  if (!goalExpectations.ok) return goalExpectations;

  const allMatches = await getGlobalMatchHistory(deps, fixture.scheduledKickoffAt, snapshotTime);
  const matches = allMatches.filter((m) => m.fixture.competitionId === fixture.competitionId);

  // Build a per-team, per-venue attack/defense lookup from the same
  // matches, mirroring poisson.ts's computeTeamStrength but exposed here
  // so every historical match can be scored under it too.
  const strengthByTeam = new Map<string, { attack: number; defense: number; venue: "home" | "away" }>();
  const teamIds = new Set<string>();
  for (const m of matches) {
    teamIds.add(m.fixture.homeTeamId);
    teamIds.add(m.fixture.awayTeamId);
  }
  for (const teamId of teamIds) {
    let homeGoalsFor = 0;
    let homeGoalsAgainst = 0;
    let homeCount = 0;
    let awayGoalsFor = 0;
    let awayGoalsAgainst = 0;
    let awayCount = 0;
    for (const { fixture: f, result } of matches) {
      if (f.homeTeamId === teamId) {
        homeGoalsFor += result.homeGoals;
        homeGoalsAgainst += result.awayGoals;
        homeCount += 1;
      } else if (f.awayTeamId === teamId) {
        awayGoalsFor += result.awayGoals;
        awayGoalsAgainst += result.homeGoals;
        awayCount += 1;
      }
    }
    strengthByTeam.set(`${teamId}:home`, { attack: homeCount > 0 ? homeGoalsFor / homeCount / goalExpectations.value.leagueAvgHomeGoals : 1, defense: homeCount > 0 ? homeGoalsAgainst / homeCount / goalExpectations.value.leagueAvgAwayGoals : 1, venue: "home" });
    strengthByTeam.set(`${teamId}:away`, { attack: awayCount > 0 ? awayGoalsFor / awayCount / goalExpectations.value.leagueAvgAwayGoals : 1, defense: awayCount > 0 ? awayGoalsAgainst / awayCount / goalExpectations.value.leagueAvgHomeGoals : 1, venue: "away" });
  }

  const snapshotMs = new Date(snapshotTime).getTime();
  const scoredMatches = matches
    .map((m) => {
      const expected = expectedGoalsForHistoricalMatch(m, goalExpectations.value.leagueAvgHomeGoals, goalExpectations.value.leagueAvgAwayGoals, strengthByTeam);
      if (!expected) return undefined;
      const daysSince = (snapshotMs - new Date(m.fixture.scheduledKickoffAt).getTime()) / (24 * 60 * 60 * 1000);
      return { x: m.result.homeGoals, y: m.result.awayGoals, lambda: expected.lambda, mu: expected.mu, weight: dixonColesTimeWeight(daysSince, xi) };
    })
    .filter((m): m is NonNullable<typeof m> => m !== undefined);

  let bestRho = 0;
  let bestLogLikelihood = -Infinity;
  for (let rho = RHO_GRID_MIN; rho <= RHO_GRID_MAX; rho += RHO_GRID_STEP) {
    let logLikelihood = 0;
    for (const m of scoredMatches) {
      const p = dixonColesJointProbability(m.x, m.y, m.lambda, m.mu, rho);
      // A degenerate (non-positive) probability under this rho is
      // treated as effectively impossible, not NaN-propagated.
      logLikelihood += m.weight * Math.log(Math.max(p, 1e-12));
    }
    if (logLikelihood > bestLogLikelihood) {
      bestLogLikelihood = logLikelihood;
      bestRho = rho;
    }
  }

  return ok({ expectedHomeGoals: goalExpectations.value.expectedHomeGoals, expectedAwayGoals: goalExpectations.value.expectedAwayGoals, rho: bestRho, historicalMatchCount: goalExpectations.value.historicalMatchCount });
}

/** Tau-adjusted joint distribution, truncated and renormalized — same reasoning as buildPoissonScorelineDistribution. */
export function buildDixonColesScorelineDistribution(expectedHomeGoals: number, expectedAwayGoals: number, rho: number, maxGoals = 10): ScorelineDistribution {
  const raw: { homeGoals: number; awayGoals: number; probability: number }[] = [];
  let total = 0;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = Math.max(dixonColesJointProbability(h, a, expectedHomeGoals, expectedAwayGoals, rho), 0);
      raw.push({ homeGoals: h, awayGoals: a, probability: p });
      total += p;
    }
  }
  return raw.map((s) => ({ ...s, probability: s.probability / total }));
}
