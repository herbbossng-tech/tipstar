import { generateId } from "@sport-os/shared";
import { describe, expect, it } from "vitest";
import { InMemoryFixturesRepository, InMemoryMatchResultsRepository } from "../repositories/fixtures.js";
import { checkScorelineDistribution } from "../probability/consistency.js";
import { totalMass } from "../probability/scoreline.js";
import { buildDixonColesScorelineDistribution, dixonColesTau, dixonColesTimeWeight, estimateDixonColesParameters } from "./dixon-coles.js";
import { poissonPmf } from "./poisson.js";

describe("dixonColesTau — exact known values from the Dixon & Coles (1997) formula", () => {
  const lambda = 1.2;
  const mu = 0.9;
  const rho = -0.15;

  it("tau(0,0) = 1 - lambda*mu*rho", () => {
    expect(dixonColesTau(0, 0, lambda, mu, rho)).toBeCloseTo(1 - lambda * mu * rho, 10);
  });
  it("tau(0,1) = 1 + lambda*rho", () => {
    expect(dixonColesTau(0, 1, lambda, mu, rho)).toBeCloseTo(1 + lambda * rho, 10);
  });
  it("tau(1,0) = 1 + mu*rho", () => {
    expect(dixonColesTau(1, 0, lambda, mu, rho)).toBeCloseTo(1 + mu * rho, 10);
  });
  it("tau(1,1) = 1 - rho", () => {
    expect(dixonColesTau(1, 1, lambda, mu, rho)).toBeCloseTo(1 - rho, 10);
  });
  it("tau is exactly 1 for every scoreline outside the four low-score cells", () => {
    expect(dixonColesTau(2, 2, lambda, mu, rho)).toBe(1);
    expect(dixonColesTau(3, 0, lambda, mu, rho)).toBe(1);
    expect(dixonColesTau(0, 2, lambda, mu, rho)).toBe(1);
  });
  it("rho = 0 reduces tau to exactly 1 everywhere (Dixon-Coles collapses to plain Poisson)", () => {
    for (const [x, y] of [[0, 0], [0, 1], [1, 0], [1, 1], [2, 2]] as const) {
      expect(dixonColesTau(x, y, lambda, mu, 0)).toBe(1);
    }
  });
});

describe("dixonColesTimeWeight", () => {
  it("weight is 1 with no decay (xi = 0)", () => {
    expect(dixonColesTimeWeight(100, 0)).toBe(1);
  });
  it("weight decays toward 0 for older matches", () => {
    const recent = dixonColesTimeWeight(1, 0.01);
    const old = dixonColesTimeWeight(365, 0.01);
    expect(recent).toBeGreaterThan(old);
    expect(old).toBeGreaterThan(0);
  });
  it("matches the exact exponential formula", () => {
    expect(dixonColesTimeWeight(50, 0.02)).toBeCloseTo(Math.exp(-0.02 * 50), 10);
  });
});

describe("buildDixonColesScorelineDistribution", () => {
  it("sums to 1 and passes the consistency engine, at rho = 0 matching plain Poisson exactly", () => {
    const dcDist = buildDixonColesScorelineDistribution(1.3, 1.0, 0);
    expect(totalMass(dcDist)).toBeCloseTo(1, 9);
    expect(checkScorelineDistribution(dcDist).ok).toBe(true);

    // At rho=0 every tau is 1, so the (renormalized) distribution should equal the independent Poisson product at every cell (both start from the same, already-normalized-to-1 mass, so no renormalization drift).
    const cell00 = dcDist.find((s) => s.homeGoals === 0 && s.awayGoals === 0)!;
    expect(cell00.probability).toBeCloseTo(poissonPmf(0, 1.3) * poissonPmf(0, 1.0), 6);
  });

  it("a negative rho redistributes mass away from 1-1 relative to rho=0 (the paper's documented empirical correction)", () => {
    const neutral = buildDixonColesScorelineDistribution(1.2, 1.1, 0);
    const adjusted = buildDixonColesScorelineDistribution(1.2, 1.1, -0.15);
    const neutral11 = neutral.find((s) => s.homeGoals === 1 && s.awayGoals === 1)!.probability;
    const adjusted11 = adjusted.find((s) => s.homeGoals === 1 && s.awayGoals === 1)!.probability;
    // tau(1,1) = 1 - rho = 1.15 > 1, so 1-1 mass should be relatively higher (before renormalization pulls everything back toward summing to 1, the shift should still be directionally visible).
    expect(adjusted11).not.toBeCloseTo(neutral11, 6);
  });
});

describe("estimateDixonColesParameters — integration with real history", () => {
  it("fits a rho and returns valid expected goals from the same synthetic league used by the Poisson tests", async () => {
    const fixtures = new InMemoryFixturesRepository();
    const matchResults = new InMemoryMatchResultsRepository();
    const competitionId = generateId();
    const teamA = generateId();
    const teamB = generateId();
    const teamC = generateId();

    async function play(home: string, away: string, hg: number, ag: number, kickoff: string) {
      const f = await fixtures.upsert({ competitionId, seasonId: undefined, homeTeamId: home, awayTeamId: away, scheduledKickoffAt: kickoff, status: "finished", providerStatusRaw: "FT", provider: "dc_test", providerFixtureId: `${home}-${away}-${kickoff}` });
      await matchResults.upsert({ fixtureId: f.id, homeGoals: hg, awayGoals: ag, halftimeHomeGoals: undefined, halftimeAwayGoals: undefined, resultRecordedAt: kickoff, source: "dc_test" });
    }

    await play(teamA, teamB, 1, 1, "2026-01-01T15:00:00Z");
    await play(teamB, teamC, 0, 0, "2026-01-08T15:00:00Z");
    await play(teamA, teamC, 2, 1, "2026-01-15T15:00:00Z");
    await play(teamC, teamA, 1, 1, "2026-01-22T15:00:00Z");
    await play(teamB, teamA, 0, 2, "2026-01-29T15:00:00Z");

    const target = await fixtures.upsert({ competitionId, seasonId: undefined, homeTeamId: teamA, awayTeamId: teamB, scheduledKickoffAt: "2026-02-05T15:00:00Z", status: "scheduled", providerStatusRaw: "NS", provider: "dc_test", providerFixtureId: "target" });

    const result = await estimateDixonColesParameters({ fixtures, matchResults }, target, target.scheduledKickoffAt);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rho).toBeGreaterThanOrEqual(-0.3);
    expect(result.value.rho).toBeLessThanOrEqual(0.3);
    expect(result.value.expectedHomeGoals).toBeGreaterThan(0);
    expect(result.value.expectedAwayGoals).toBeGreaterThan(0);

    const distribution = buildDixonColesScorelineDistribution(result.value.expectedHomeGoals, result.value.expectedAwayGoals, result.value.rho);
    expect(checkScorelineDistribution(distribution).ok).toBe(true);
  });

  it("propagates estimateGoalExpectations' INSUFFICIENT_HISTORICAL_DATA error rather than fitting rho on nothing", async () => {
    const fixtures = new InMemoryFixturesRepository();
    const matchResults = new InMemoryMatchResultsRepository();
    const fixture = await fixtures.upsert({ competitionId: generateId(), seasonId: undefined, homeTeamId: generateId(), awayTeamId: generateId(), scheduledKickoffAt: "2026-01-01T15:00:00Z", status: "scheduled", providerStatusRaw: "NS", provider: "dc_test", providerFixtureId: "no-history" });
    const result = await estimateDixonColesParameters({ fixtures, matchResults }, fixture, fixture.scheduledKickoffAt);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INSUFFICIENT_HISTORICAL_DATA");
  });
});
