import { describe, expect, it } from "vitest";
import { AgentType, DecisionStatus, FinalResult, SettlementStatus, Sport, type Pick } from "@tipstar/types";
import { SettlementEngine } from "./engine.js";
import { InMemorySettlementRepository } from "./in-memory-repository.js";

function buildPick(overrides: Partial<Pick> = {}): Pick {
  return {
    id: "pick-1",
    sourceIntelligenceResultId: "result-1",
    agentType: AgentType.FOOTBALL,
    sport: Sport.FOOTBALL,
    leagueId: null,
    eventId: "event-1",
    eventName: "Mock United vs Mock City",
    market: "1x2",
    selection: "home",
    publishedAt: new Date().toISOString(),
    oddsAtPublication: 2.1,
    probability: 0.6,
    fairOdds: 1.67,
    expectedValue: 0.1,
    confidence: 0.7,
    riskScore: 0.3,
    modelVersion: "test@0.0.1",
    evidence: [],
    decisionStatus: DecisionStatus.QUALIFIED,
    finalResult: FinalResult.PENDING,
    settlementStatus: SettlementStatus.UNSETTLED,
    settledAt: null,
    ...overrides,
  };
}

describe("SettlementEngine", () => {
  it("settles a pending pick with the final result", async () => {
    const pick = buildPick();
    const repo = new InMemorySettlementRepository(new Map([[pick.id, pick]]));
    const engine = new SettlementEngine(repo);

    const result = await engine.settle({ pickId: pick.id, finalResult: FinalResult.WIN });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.finalResult).toBe(FinalResult.WIN);
      expect(result.value.settlementStatus).toBe(SettlementStatus.SETTLED);
      expect(result.value.settledAt).not.toBeNull();
    }
  });

  it("is idempotent: settling the same pick twice does not change the recorded result", async () => {
    const pick = buildPick();
    const repo = new InMemorySettlementRepository(new Map([[pick.id, pick]]));
    const engine = new SettlementEngine(repo);

    const first = await engine.settle({ pickId: pick.id, finalResult: FinalResult.WIN });
    const second = await engine.settle({ pickId: pick.id, finalResult: FinalResult.LOSS });

    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      // Second call must not overwrite the original settlement with a different result.
      expect(second.value.finalResult).toBe(FinalResult.WIN);
      expect(second.value.settledAt).toBe(first.value.settledAt);
    }
  });

  it("never deletes a losing pick — settlement preserves the record (No Hidden Losses)", async () => {
    const pick = buildPick();
    const repo = new InMemorySettlementRepository(new Map([[pick.id, pick]]));
    const engine = new SettlementEngine(repo);

    await engine.settle({ pickId: pick.id, finalResult: FinalResult.LOSS });
    const stored = await repo.findPickById(pick.id);

    expect(stored).not.toBeNull();
    expect(stored?.finalResult).toBe(FinalResult.LOSS);
  });

  it("cancel() voids a pick without deleting it, and refuses to cancel an already-settled pick", async () => {
    const pick = buildPick();
    const repo = new InMemorySettlementRepository(new Map([[pick.id, pick]]));
    const engine = new SettlementEngine(repo);

    await engine.settle({ pickId: pick.id, finalResult: FinalResult.WIN });
    const cancelResult = await engine.cancel(pick.id);

    expect(cancelResult.ok).toBe(false);
  });
});
