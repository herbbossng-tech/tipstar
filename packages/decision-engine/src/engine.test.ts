import { describe, expect, it } from "vitest";
import { AgentType, DecisionStatus, IntelligenceResultStatus, Sport, type IntelligenceResult } from "@tipstar/types";
import { DecisionEngine } from "./engine.js";

const NOW = new Date("2026-01-01T12:00:00Z");

function buildResult(overrides: Partial<IntelligenceResult> = {}): IntelligenceResult {
  return {
    id: "result-1",
    agentType: AgentType.FOOTBALL,
    sport: Sport.FOOTBALL,
    eventId: "event-1",
    market: "1x2",
    selection: "home",
    probability: 0.6,
    fairOdds: 1.67,
    marketOdds: 2.1,
    expectedValue: 0.1,
    confidence: 0.7,
    riskScore: 0.3,
    evidence: [{ label: "form", value: "good", sourceType: "derived_feature", sourceRef: null }],
    modelVersion: "test@0.0.1",
    generatedAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
    status: IntelligenceResultStatus.GENERATED,
    isMock: true,
    ...overrides,
  };
}

describe("DecisionEngine", () => {
  const engine = new DecisionEngine();

  it("qualifies a strong, fresh, well-evidenced result", () => {
    const outcome = engine.evaluate(buildResult(), NOW);
    expect(outcome.status).toBe(DecisionStatus.QUALIFIED);
  });

  it("marks an insufficient_data intelligence result as INSUFFICIENT_DATA", () => {
    const outcome = engine.evaluate(buildResult({ status: IntelligenceResultStatus.INSUFFICIENT_DATA }), NOW);
    expect(outcome.status).toBe(DecisionStatus.INSUFFICIENT_DATA);
  });

  it("marks a result with no evidence as INSUFFICIENT_DATA", () => {
    const outcome = engine.evaluate(buildResult({ evidence: [] }), NOW);
    expect(outcome.status).toBe(DecisionStatus.INSUFFICIENT_DATA);
  });

  it("waits on stale data instead of publishing it", () => {
    const outcome = engine.evaluate(buildResult({ generatedAt: new Date(NOW.getTime() - 2 * 3_600_000).toISOString() }), NOW);
    expect(outcome.status).toBe(DecisionStatus.WAIT);
  });

  it("waits when market odds are required but missing", () => {
    const outcome = engine.evaluate(buildResult({ marketOdds: null }), NOW);
    expect(outcome.status).toBe(DecisionStatus.WAIT);
  });

  it("rejects trading when risk score is too high", () => {
    const outcome = engine.evaluate(buildResult({ riskScore: 0.95 }), NOW);
    expect(outcome.status).toBe(DecisionStatus.NO_TRADE);
  });

  it("rejects trading when expected value is negative", () => {
    const outcome = engine.evaluate(buildResult({ expectedValue: -0.05 }), NOW);
    expect(outcome.status).toBe(DecisionStatus.NO_TRADE);
  });

  it("monitors a borderline-confidence result rather than publishing or rejecting", () => {
    const outcome = engine.evaluate(buildResult({ confidence: 0.4 }), NOW);
    expect(outcome.status).toBe(DecisionStatus.MONITOR);
  });

  it("rejects a very low-confidence result outright", () => {
    const outcome = engine.evaluate(buildResult({ confidence: 0.05 }), NOW);
    expect(outcome.status).toBe(DecisionStatus.REJECTED);
  });

  it("never qualifies twice with contradictory reasons — QUALIFIED always carries a positive reason", () => {
    const outcome = engine.evaluate(buildResult(), NOW);
    expect(outcome.reasons.length).toBeGreaterThan(0);
  });
});
