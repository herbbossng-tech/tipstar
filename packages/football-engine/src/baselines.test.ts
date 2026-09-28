import { generateId } from "@sport-os/shared";
import { describe, expect, it } from "vitest";
import { checkProbability1x2 } from "./probability/consistency.js";
import { InMemoryFixturesRepository, InMemoryMatchResultsRepository } from "./repositories/fixtures.js";
import { eloBaseline, historicalFrequencyBaseline, marketImpliedBaseline, naiveBaseline, poissonBaseline } from "./baselines.js";
import { computeFeatureVector } from "./features/registry.js";
import { InMemoryOddsObservationsRepository } from "./repositories/observations.js";

async function seedLeague() {
  const fixtures = new InMemoryFixturesRepository();
  const matchResults = new InMemoryMatchResultsRepository();
  const oddsObservations = new InMemoryOddsObservationsRepository();
  const competitionId = generateId();
  const teamA = generateId();
  const teamB = generateId();
  const teamC = generateId();

  async function play(home: string, away: string, hg: number, ag: number, kickoff: string) {
    const f = await fixtures.upsert({ competitionId, seasonId: undefined, homeTeamId: home, awayTeamId: away, scheduledKickoffAt: kickoff, status: "finished", providerStatusRaw: "FT", provider: "baseline_test", providerFixtureId: `${home}-${away}-${kickoff}` });
    await matchResults.upsert({ fixtureId: f.id, homeGoals: hg, awayGoals: ag, halftimeHomeGoals: undefined, halftimeAwayGoals: undefined, resultRecordedAt: kickoff, source: "baseline_test" });
  }

  await play(teamA, teamB, 2, 0, "2026-01-01T15:00:00Z");
  await play(teamB, teamC, 1, 1, "2026-01-08T15:00:00Z");
  await play(teamA, teamC, 3, 1, "2026-01-15T15:00:00Z");
  await play(teamC, teamA, 0, 2, "2026-01-22T15:00:00Z");
  await play(teamB, teamA, 0, 1, "2026-01-29T15:00:00Z");

  const target = await fixtures.upsert({ competitionId, seasonId: undefined, homeTeamId: teamA, awayTeamId: teamB, scheduledKickoffAt: "2026-02-05T15:00:00Z", status: "scheduled", providerStatusRaw: "NS", provider: "baseline_test", providerFixtureId: "target" });

  return { fixtures, matchResults, oddsObservations, target };
}

describe("naiveBaseline", () => {
  it("is exactly equal-probability and passes the consistency engine", () => {
    const result = naiveBaseline();
    expect(result.probability1x2).toEqual({ home: 1 / 3, draw: 1 / 3, away: 1 / 3 });
    expect(checkProbability1x2(result.probability1x2).ok).toBe(true);
  });
});

describe("historicalFrequencyBaseline", () => {
  it("computes valid probabilities from real historical outcome rates", async () => {
    const { fixtures, matchResults, target } = await seedLeague();
    const result = await historicalFrequencyBaseline({ fixtures, matchResults }, target, target.scheduledKickoffAt);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(checkProbability1x2(result.value.probability1x2).ok).toBe(true);
  });

  it("fails closed (no fabricated prior) with zero history", async () => {
    const fixtures = new InMemoryFixturesRepository();
    const matchResults = new InMemoryMatchResultsRepository();
    const fixture = await fixtures.upsert({ competitionId: generateId(), seasonId: undefined, homeTeamId: generateId(), awayTeamId: generateId(), scheduledKickoffAt: "2026-01-01T15:00:00Z", status: "scheduled", providerStatusRaw: "NS", provider: "baseline_test", providerFixtureId: "no-history" });
    const result = await historicalFrequencyBaseline({ fixtures, matchResults }, fixture, fixture.scheduledKickoffAt);
    expect(result.ok).toBe(false);
  });
});

describe("eloBaseline", () => {
  it("computes a valid, Elo-informed probability distribution", async () => {
    const { fixtures, matchResults, target } = await seedLeague();
    const result = await eloBaseline({ fixtures, matchResults }, target, target.scheduledKickoffAt);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(checkProbability1x2(result.value.probability1x2).ok).toBe(true);
    // Team A has won every match so far — should be favored over Team B.
    expect(result.value.probability1x2.home).toBeGreaterThan(result.value.probability1x2.away);
  });
});

describe("poissonBaseline", () => {
  it("computes a valid probability distribution derived from the Poisson scoreline distribution", async () => {
    const { fixtures, matchResults, target } = await seedLeague();
    const result = await poissonBaseline({ fixtures, matchResults }, target, target.scheduledKickoffAt);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(checkProbability1x2(result.value.probability1x2).ok).toBe(true);
  });
});

describe("marketImpliedBaseline", () => {
  it("removes the overround via proportional normalization and produces a valid distribution", async () => {
    const { fixtures, matchResults, oddsObservations, target } = await seedLeague();
    const base = { fixtureId: target.id, marketType: "match_result_1x2", bookmakerSource: "synthetic_bookmaker", provider: "baseline_test", providerObservationId: undefined, ingestionRunId: undefined, temporalReliability: "confirmed" as const, observedAt: "2026-02-04T10:00:00Z", providerPublishedAt: "2026-02-04T10:00:00Z" };
    await oddsObservations.insert({ ...base, selection: "home", odds: 1.8 });
    await oddsObservations.insert({ ...base, selection: "draw", odds: 3.6 });
    await oddsObservations.insert({ ...base, selection: "away", odds: 4.5 });

    const ctx = { fixtureId: target.id, snapshotTime: target.scheduledKickoffAt, now: target.scheduledKickoffAt };
    const features = await computeFeatureVector(ctx, { fixtures, matchResults, oddsObservations }, target, "baseline_test");
    const result = marketImpliedBaseline(features);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(checkProbability1x2(result.value.probability1x2).ok).toBe(true);
    // Raw implied probs (1/1.8 + 1/3.6 + 1/4.5) sum to > 1 (the overround) — normalized probabilities must still sum to exactly 1.
    const sum = result.value.probability1x2.home + result.value.probability1x2.draw + result.value.probability1x2.away;
    expect(sum).toBeCloseTo(1, 9);
  });

  it("fails closed when odds are unavailable, never fabricating a market view", async () => {
    const { fixtures, matchResults, oddsObservations, target } = await seedLeague();
    const ctx = { fixtureId: target.id, snapshotTime: target.scheduledKickoffAt, now: target.scheduledKickoffAt };
    const features = await computeFeatureVector(ctx, { fixtures, matchResults, oddsObservations }, target, "baseline_test");
    const result = marketImpliedBaseline(features);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ODDS_UNAVAILABLE");
  });
});
