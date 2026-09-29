import { generateId } from "@sport-os/shared";
import { describe, expect, it } from "vitest";
import { InMemoryFixturesRepository, InMemoryMatchResultsRepository } from "../repositories/fixtures.js";
import { checkScorelineDistribution } from "../probability/consistency.js";
import { totalMass } from "../probability/scoreline.js";
import { buildPoissonScorelineDistribution, estimateGoalExpectations, poissonPmf } from "./poisson.js";

describe("poissonPmf — known textbook values", () => {
  it("P(0; lambda=1) = e^-1", () => {
    expect(poissonPmf(0, 1)).toBeCloseTo(Math.exp(-1), 10);
  });
  it("P(1; lambda=1) = e^-1", () => {
    expect(poissonPmf(1, 1)).toBeCloseTo(Math.exp(-1), 10);
  });
  it("P(2; lambda=1) = e^-1 / 2", () => {
    expect(poissonPmf(2, 1)).toBeCloseTo(Math.exp(-1) / 2, 10);
  });
  it("P(0; lambda=0.5) = e^-0.5", () => {
    expect(poissonPmf(0, 0.5)).toBeCloseTo(Math.exp(-0.5), 10);
  });
  it("P(3; lambda=2) matches the closed form 2^3 e^-2 / 3!", () => {
    expect(poissonPmf(3, 2)).toBeCloseTo((Math.pow(2, 3) * Math.exp(-2)) / 6, 10);
  });
  it("rejects a negative or non-integer k", () => {
    expect(poissonPmf(-1, 1)).toBe(0);
    expect(poissonPmf(1.5, 1)).toBe(0);
  });
});

describe("buildPoissonScorelineDistribution", () => {
  it("produces a distribution that sums to 1 (passes the consistency engine)", () => {
    const dist = buildPoissonScorelineDistribution(1.4, 1.1);
    expect(totalMass(dist)).toBeCloseTo(1, 9);
    expect(checkScorelineDistribution(dist).ok).toBe(true);
  });

  it("concentrates mass near (round(lambda), round(mu)) for a reasonable lambda/mu", () => {
    const dist = buildPoissonScorelineDistribution(2, 1);
    const mostLikely = [...dist].sort((a, b) => b.probability - a.probability)[0]!;
    // Poisson(2) peaks at 1-2, Poisson(1) peaks at 0-1 — the joint mode should be a low, plausible scoreline.
    expect(mostLikely.homeGoals).toBeLessThanOrEqual(3);
    expect(mostLikely.awayGoals).toBeLessThanOrEqual(2);
  });
});

describe("estimateGoalExpectations", () => {
  async function seed() {
    const fixtures = new InMemoryFixturesRepository();
    const matchResults = new InMemoryMatchResultsRepository();
    const competitionId = generateId();
    const strongTeam = generateId();
    const weakTeam = generateId();
    const midTeam = generateId();

    async function play(home: string, away: string, hg: number, ag: number, kickoff: string) {
      const f = await fixtures.upsert({ competitionId, seasonId: undefined, homeTeamId: home, awayTeamId: away, scheduledKickoffAt: kickoff, status: "finished", providerStatusRaw: "FT", provider: "poisson_test", providerFixtureId: `${home}-${away}-${kickoff}` });
      await matchResults.insert({ fixtureId: f.id, homeGoals: hg, awayGoals: ag, halftimeHomeGoals: undefined, halftimeAwayGoals: undefined, resultRecordedAt: kickoff, source: "poisson_test" });
    }

    await play(strongTeam, weakTeam, 4, 0, "2026-01-01T15:00:00Z");
    await play(weakTeam, midTeam, 0, 2, "2026-01-08T15:00:00Z");
    await play(strongTeam, midTeam, 3, 1, "2026-01-15T15:00:00Z");
    await play(midTeam, strongTeam, 1, 2, "2026-01-22T15:00:00Z");

    const target = await fixtures.upsert({ competitionId, seasonId: undefined, homeTeamId: strongTeam, awayTeamId: weakTeam, scheduledKickoffAt: "2026-01-29T15:00:00Z", status: "scheduled", providerStatusRaw: "NS", provider: "poisson_test", providerFixtureId: "target" });

    return { fixtures, matchResults, strongTeam, weakTeam, midTeam, target };
  }

  it("gives a clearly stronger attacking team a higher expected-goals estimate than a weaker one", async () => {
    const { fixtures, matchResults, target } = await seed();
    const result = await estimateGoalExpectations({ fixtures, matchResults }, target, target.scheduledKickoffAt);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // strongTeam (home, scored 4+3=7 across 2 home matches) vs weakTeam (away, conceded 4 in its 1 away match) — expect a high home expectation.
    expect(result.value.expectedHomeGoals).toBeGreaterThan(1);
  });

  it("returns INSUFFICIENT_HISTORICAL_DATA rather than fabricating a league average with zero history", async () => {
    const fixtures = new InMemoryFixturesRepository();
    const matchResults = new InMemoryMatchResultsRepository();
    const fixture = await fixtures.upsert({ competitionId: generateId(), seasonId: undefined, homeTeamId: generateId(), awayTeamId: generateId(), scheduledKickoffAt: "2026-01-01T15:00:00Z", status: "scheduled", providerStatusRaw: "NS", provider: "poisson_test", providerFixtureId: "no-history" });
    const result = await estimateGoalExpectations({ fixtures, matchResults }, fixture, fixture.scheduledKickoffAt);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INSUFFICIENT_HISTORICAL_DATA");
  });
});
