/**
 * Cross-package integration test: exercises the full evidence-first
 * pipeline described in docs/architecture/overview.md end to end, using
 * the real package implementations (only the sports data source is a
 * mock adapter, clearly flagged) rather than re-testing each package in
 * isolation.
 *
 *   MockFootballProvider → FootballAgent (mock mode) → DecisionEngine
 *     → PickEngine.publish → SettlementEngine.settle → calculatePerformanceStats
 */
import { describe, expect, it } from "vitest";
import { MockFootballProvider } from "@tipstar/sports";
import { FootballAgent } from "@tipstar/intelligence";
import { DecisionEngine, DEFAULT_DECISION_CRITERIA } from "@tipstar/decision-engine";
import { PickEngine, InMemoryPickRepository, type PickCandidate } from "@tipstar/picks";
import { SettlementEngine, InMemorySettlementRepository } from "@tipstar/settlement";
import { calculatePerformanceStats } from "@tipstar/performance";
import { DecisionStatus, FinalResult, type Pick } from "@tipstar/types";

const EVENT_ID = "00000000-0000-0000-0000-000000000100";

describe("end-to-end pipeline", () => {
  it("takes a mock intelligence result all the way through to settled performance stats", async () => {
    const provider = new MockFootballProvider();
    const agent = new FootballAgent(provider, "mock");

    const intelligenceResult = await agent.evaluate({ eventId: EVENT_ID, market: "1x2", selection: "home" });
    expect(intelligenceResult.isMock).toBe(true);

    // Loosen thresholds to match the mock fixture's numbers (2.1 odds / 0.45 probability
    // is a deliberately unremarkable dev fixture, not a real edge) — this test exercises
    // the pipeline wiring, not the Decision Engine's real production thresholds (see
    // packages/decision-engine/src/engine.test.ts for that).
    const decisionEngine = new DecisionEngine({
      ...DEFAULT_DECISION_CRITERIA,
      minConfidenceToQualify: 0.3,
      minExpectedValue: -1,
    });
    const decision = decisionEngine.evaluate(intelligenceResult);
    expect(decision.status).toBe(DecisionStatus.QUALIFIED);

    const pickRepository = new InMemoryPickRepository();
    const pickEngine = new PickEngine(pickRepository);
    const candidate: PickCandidate = {
      sourceIntelligenceResultId: intelligenceResult.id,
      agentType: intelligenceResult.agentType,
      sport: intelligenceResult.sport,
      leagueId: null,
      eventId: intelligenceResult.eventId,
      eventName: "Mock United vs Mock City",
      market: intelligenceResult.market,
      selection: intelligenceResult.selection,
      oddsAtPublication: intelligenceResult.marketOdds,
      probability: intelligenceResult.probability,
      fairOdds: intelligenceResult.fairOdds,
      expectedValue: intelligenceResult.expectedValue,
      confidence: intelligenceResult.confidence,
      riskScore: intelligenceResult.riskScore,
      modelVersion: intelligenceResult.modelVersion,
      evidence: intelligenceResult.evidence,
      decisionStatus: decision.status,
    };

    const publishResult = await pickEngine.publish(candidate);
    expect(publishResult.ok).toBe(true);
    if (!publishResult.ok) return;
    const pick = publishResult.value;
    expect(pick.settlementStatus).toBe("unsettled");

    // Republishing the same source result must not create a duplicate pick.
    const republish = await pickEngine.publish(candidate);
    expect(republish.ok && republish.value.id === pick.id).toBe(true);

    const picksById = new Map<string, Pick>([[pick.id, pick]]);
    const settlementEngine = new SettlementEngine(new InMemorySettlementRepository(picksById));
    const settleResult = await settlementEngine.settle({ pickId: pick.id, finalResult: FinalResult.WIN });
    expect(settleResult.ok).toBe(true);
    if (!settleResult.ok) return;

    const stats = calculatePerformanceStats([settleResult.value]);
    expect(stats.totalPicks).toBe(1);
    expect(stats.wins).toBe(1);
    expect(stats.winRate).toBe(1);
  });
});
