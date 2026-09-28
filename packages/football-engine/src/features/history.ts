import type { ISODateString, UUID } from "@sport-os/shared";
import type { Fixture, MatchResult } from "../canonical.js";
import type { FixturesRepository, MatchResultsRepository } from "../repositories/fixtures.js";

/**
 * The single leakage-safe history primitive every rolling feature family
 * (Elo, Form, Goals, Rest/Schedule, H2H) builds on — one implementation
 * of "what matches did this team play before this one, whose results
 * were actually known by this snapshot" rather than each feature family
 * re-deriving its own (and risking getting it wrong differently each
 * time).
 *
 * Two conditions must both hold for a past match to be included:
 *   1. its kickoff was strictly before the target fixture's kickoff
 *      (FixturesRepository.listForTeamBeforeKickoff's job), and
 *   2. its result was actually known by snapshotTime — i.e.
 *      MatchResult.resultRecordedAt <= snapshotTime (this module's job).
 * A match satisfying (1) but not (2) (kicked off in the past, but its
 * result hadn't been recorded yet as of this snapshot) is correctly
 * excluded, exactly mirroring LeakageGuard.getDataAsOf's treatment of
 * the target fixture's own match result.
 */

export interface HistoricalMatch {
  readonly fixture: Fixture;
  readonly result: MatchResult;
  /** Whether `teamId` (the team this history belongs to) played at home in this historical match. */
  readonly isHome: boolean;
}

export interface TeamMatchHistory {
  readonly teamId: UUID;
  /** The target fixture's own scheduledKickoffAt — the upper bound every match in `matches` is strictly before. */
  readonly beforeKickoff: ISODateString;
  readonly snapshotTime: ISODateString;
  /** Ascending chronological order (oldest first). Only matches with a result known by snapshotTime. */
  readonly matches: readonly HistoricalMatch[];
}

export interface HistoryDependencies {
  readonly fixtures: FixturesRepository;
  readonly matchResults: MatchResultsRepository;
}

function resultKnownBy(result: MatchResult, snapshotMs: number): boolean {
  return new Date(result.resultRecordedAt).getTime() <= snapshotMs;
}

export async function getTeamMatchHistory(deps: HistoryDependencies, teamId: UUID, beforeKickoff: ISODateString, snapshotTime: ISODateString): Promise<TeamMatchHistory> {
  const fixtures = await deps.fixtures.listForTeamBeforeKickoff(teamId, beforeKickoff);
  if (fixtures.length === 0) {
    return { teamId, beforeKickoff, snapshotTime, matches: [] };
  }

  const results = await deps.matchResults.listForFixtureIds(fixtures.map((f) => f.id));
  const resultByFixtureId = new Map(results.map((r) => [r.fixtureId, r]));
  const snapshotMs = new Date(snapshotTime).getTime();

  const matches: HistoricalMatch[] = [];
  for (const fixture of fixtures) {
    const result = resultByFixtureId.get(fixture.id);
    if (!result) continue;
    if (!resultKnownBy(result, snapshotMs)) continue;
    matches.push({ fixture, result, isHome: fixture.homeTeamId === teamId });
  }

  return { teamId, beforeKickoff, snapshotTime, matches };
}

/** Global chronological match history (every team, not just one) — the building block Elo needs since a team's rating depends transitively on every opponent it has played. Same two-condition leakage gate as getTeamMatchHistory. */
export interface GlobalHistoricalMatch {
  readonly fixture: Fixture;
  readonly result: MatchResult;
}

export async function getGlobalMatchHistory(deps: HistoryDependencies, beforeKickoff: ISODateString, snapshotTime: ISODateString): Promise<readonly GlobalHistoricalMatch[]> {
  const fixtures = await deps.fixtures.listAllBeforeKickoff(beforeKickoff);
  if (fixtures.length === 0) return [];

  const results = await deps.matchResults.listForFixtureIds(fixtures.map((f) => f.id));
  const resultByFixtureId = new Map(results.map((r) => [r.fixtureId, r]));
  const snapshotMs = new Date(snapshotTime).getTime();

  const matches: GlobalHistoricalMatch[] = [];
  for (const fixture of fixtures) {
    const result = resultByFixtureId.get(fixture.id);
    if (!result) continue;
    if (!resultKnownBy(result, snapshotMs)) continue;
    matches.push({ fixture, result });
  }
  return matches;
}

export function matchOutcomeForTeam(match: HistoricalMatch): "win" | "draw" | "loss" {
  const { result, isHome } = match;
  const teamGoals = isHome ? result.homeGoals : result.awayGoals;
  const opponentGoals = isHome ? result.awayGoals : result.homeGoals;
  if (teamGoals > opponentGoals) return "win";
  if (teamGoals < opponentGoals) return "loss";
  return "draw";
}

export function teamGoalsFor(match: HistoricalMatch): number {
  return match.isHome ? match.result.homeGoals : match.result.awayGoals;
}

export function teamGoalsAgainst(match: HistoricalMatch): number {
  return match.isHome ? match.result.awayGoals : match.result.homeGoals;
}
