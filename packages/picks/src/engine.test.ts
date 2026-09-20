import { describe, expect, it } from "vitest";
import { AgentType, DecisionStatus, Sport } from "@tipstar/types";
import type { PickCandidate } from "./candidate.js";
import { PickEngine } from "./engine.js";
import { InMemoryPickRepository } from "./in-memory-repository.js";

function buildCandidate(overrides: Partial<PickCandidate> = {}): PickCandidate {
  return {
    sourceIntelligenceResultId: "result-1",
    agentType: AgentType.FOOTBALL,
    sport: Sport.FOOTBALL,
    leagueId: null,
    eventId: "event-1",
    eventName: "Mock United vs Mock City",
    market: "1x2",
    selection: "home",
    oddsAtPublication: 2.1,
    probability: 0.6,
    fairOdds: 1.67,
    expectedValue: 0.1,
    confidence: 0.7,
    riskScore: 0.3,
    modelVersion: "test@0.0.1",
    evidence: [],
    decisionStatus: DecisionStatus.QUALIFIED,
    ...overrides,
  };
}

describe("PickEngine", () => {
  it("publishes a QUALIFIED candidate as a pending, unsettled pick", async () => {
    const engine = new PickEngine(new InMemoryPickRepository());
    const result = await engine.publish(buildCandidate());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.decisionStatus).toBe(DecisionStatus.QUALIFIED);
      expect(result.value.finalResult).toBe("pending");
      expect(result.value.settlementStatus).toBe("unsettled");
    }
  });

  it("refuses to publish a non-QUALIFIED candidate", async () => {
    const engine = new PickEngine(new InMemoryPickRepository());
    const result = await engine.publish(buildCandidate({ decisionStatus: DecisionStatus.WAIT }));
    expect(result.ok).toBe(false);
  });

  it("is idempotent: publishing the same source result twice returns the same pick", async () => {
    const engine = new PickEngine(new InMemoryPickRepository());
    const first = await engine.publish(buildCandidate());
    const second = await engine.publish(buildCandidate());

    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.value.id).toBe(first.value.id);
    }
  });

  it("corrects a field while preserving an audit trail of the original value", async () => {
    const repository = new InMemoryPickRepository();
    const engine = new PickEngine(repository);
    const published = await engine.publish(buildCandidate());
    if (!published.ok) throw new Error("setup failed");

    const corrected = await engine.correct(published.value.id, "oddsAtPublication", "2.5", "admin-1", "Vendor sent wrong price initially");

    expect(corrected.ok).toBe(true);
    if (corrected.ok) {
      expect(corrected.value.oddsAtPublication).toBe(2.5);
    }
    expect(repository.corrections).toHaveLength(1);
    expect(repository.corrections[0]?.originalValue).toBe("2.1");
    expect(repository.corrections[0]?.correctedValue).toBe("2.5");
    expect(repository.corrections[0]?.reason).toContain("Vendor");
  });

  it("refuses a correction with no reason given", async () => {
    const repository = new InMemoryPickRepository();
    const engine = new PickEngine(repository);
    const published = await engine.publish(buildCandidate());
    if (!published.ok) throw new Error("setup failed");

    const result = await engine.correct(published.value.id, "oddsAtPublication", "2.5", "admin-1", "  ");
    expect(result.ok).toBe(false);
  });
});
