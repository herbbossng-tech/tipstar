import { describe, expect, it } from "vitest";
import { AgentType, DecisionStatus, FinalResult, SettlementStatus, Sport, type Pick } from "@tipstar/types";
import { calculatePerformanceStats } from "./stats.js";

let counter = 0;
function buildPick(overrides: Partial<Pick> = {}): Pick {
  counter += 1;
  return {
    id: `pick-${counter}`,
    sourceIntelligenceResultId: `result-${counter}`,
    agentType: AgentType.FOOTBALL,
    sport: Sport.FOOTBALL,
    leagueId: null,
    eventId: `event-${counter}`,
    eventName: "Fixture",
    market: "1x2",
    selection: "home",
    publishedAt: new Date(2026, 0, counter).toISOString(),
    oddsAtPublication: 2,
    probability: 0.5,
    fairOdds: 2,
    expectedValue: 0,
    confidence: 0.5,
    riskScore: 0.5,
    modelVersion: "test@0.0.1",
    evidence: [],
    decisionStatus: DecisionStatus.QUALIFIED,
    finalResult: FinalResult.PENDING,
    settlementStatus: SettlementStatus.UNSETTLED,
    settledAt: null,
    ...overrides,
  };
}

describe("calculatePerformanceStats", () => {
  it("counts losses and voids — never hides them (No Hidden Losses)", () => {
    const picks = [
      buildPick({ finalResult: FinalResult.WIN }),
      buildPick({ finalResult: FinalResult.LOSS }),
      buildPick({ finalResult: FinalResult.LOSS }),
      buildPick({ finalResult: FinalResult.VOID }),
    ];
    const stats = calculatePerformanceStats(picks);

    expect(stats.totalPicks).toBe(4);
    expect(stats.wins).toBe(1);
    expect(stats.losses).toBe(2);
    expect(stats.voids).toBe(1);
    expect(stats.winRate).toBeCloseTo(1 / 3);
  });

  it("computes profit/loss and ROI from a flat 1-unit stake, at 2.0 odds", () => {
    const picks = [
      buildPick({ finalResult: FinalResult.WIN, oddsAtPublication: 2 }),
      buildPick({ finalResult: FinalResult.LOSS, oddsAtPublication: 2 }),
    ];
    const stats = calculatePerformanceStats(picks);

    // +1 unit profit on the win, -1 unit on the loss => net 0 across 2 units staked.
    expect(stats.profitLossUnits).toBeCloseTo(0);
    expect(stats.roi).toBeCloseTo(0);
  });

  it("tracks winning and losing streaks in publication order", () => {
    const picks = [
      buildPick({ finalResult: FinalResult.WIN }),
      buildPick({ finalResult: FinalResult.WIN }),
      buildPick({ finalResult: FinalResult.LOSS }),
      buildPick({ finalResult: FinalResult.WIN }),
    ];
    const stats = calculatePerformanceStats(picks);

    expect(stats.longestWinningStreak).toBe(2);
    expect(stats.longestLosingStreak).toBe(1);
    expect(stats.currentStreak).toEqual({ type: "win", count: 1 });
  });

  it("excludes pending picks from win rate but counts them in totalPicks/pending", () => {
    const picks = [buildPick({ finalResult: FinalResult.WIN }), buildPick({ finalResult: FinalResult.PENDING })];
    const stats = calculatePerformanceStats(picks);

    expect(stats.totalPicks).toBe(2);
    expect(stats.pending).toBe(1);
    expect(stats.winRate).toBe(1);
  });
});
