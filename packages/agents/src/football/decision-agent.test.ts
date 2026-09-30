import type { DecisionEngine, ValueAssessment } from "@sport-os/football-engine";
import { DecisionOutcome, NotImplementedDecisionEngine, ValueEligibility, VALUE_CALCULATION_VERSION } from "@sport-os/football-engine";
import { describe, expect, it } from "vitest";
import type { FootballIntelligenceResult } from "./intelligence-agent.js";
import { FootballDecisionAgent } from "./decision-agent.js";

const FIXTURE_ID = "11111111-1111-1111-1111-111111111111";

/** Fills in Section 07's richer `ValueAssessment` fields with defaults so these tests can focus on the fields they actually vary (`qualifies`/`decision`) — mirrors a real `evaluateValue()` output shape without depending on it. */
function buildValueAssessment(overrides: Partial<ValueAssessment> & Pick<ValueAssessment, "eventId" | "marketType" | "selection" | "calibratedProbability" | "marketOdds" | "expectedValue" | "qualifies">): ValueAssessment {
  return {
    line: undefined,
    fairOdds: overrides.calibratedProbability !== null ? 1 / overrides.calibratedProbability : undefined,
    edge: null,
    dataQuality: "AVAILABLE",
    oddsTimestamp: "2026-01-10T17:00:00Z",
    modelVersion: "test-v1",
    calculationVersion: VALUE_CALCULATION_VERSION,
    eligibility: ValueEligibility.VALID,
    decision: overrides.qualifies ? DecisionOutcome.BET : DecisionOutcome.NO_EDGE,
    reasons: [],
    evaluatedAt: "2026-01-10T17:00:00Z",
    ...overrides,
  };
}

function fakeIntelligence(): FootballIntelligenceResult {
  return {
    fixtureId: FIXTURE_ID,
    snapshotTime: "2026-01-10T18:00:00Z",
    prediction: {} as never,
    modelAgreement: undefined,
    dataQuality: "AVAILABLE",
    warnings: [],
    eligibility: "eligible",
  };
}

class StubDecisionEngine implements DecisionEngine {
  constructor(private readonly assessments: Record<string, ValueAssessment>) {}
  async assess(eventId: string, _marketType: never, selection: string): Promise<ValueAssessment> {
    const key = `${eventId}:${selection}`;
    const found = this.assessments[key];
    if (!found) throw new Error(`no stub assessment for ${key}`);
    return found;
  }
}

describe("FootballDecisionAgent", () => {
  it("only includes qualifying candidates as ticket legs, never every candidate blindly", async () => {
    const engine = new StubDecisionEngine({
      "fixture-1:HOME": buildValueAssessment({ eventId: "fixture-1", marketType: "match_result_1x2", selection: "HOME", calibratedProbability: 0.6, marketOdds: 2.0, expectedValue: 0.2, qualifies: true }),
      "fixture-1:OVER_2_5": buildValueAssessment({ eventId: "fixture-1", marketType: "over_under", selection: "OVER_2_5", calibratedProbability: 0.4, marketOdds: 1.5, expectedValue: -0.1, qualifies: false }),
    });
    const agent = new FootballDecisionAgent({ decisionEngine: engine });
    agent.markReady();
    const response = await agent.execute({
      requestId: "req-1",
      input: {
        intelligence: fakeIntelligence(),
        candidateMarkets: [
          { eventId: "fixture-1", marketType: "match_result_1x2" as never, selection: "HOME" },
          { eventId: "fixture-1", marketType: "over_under" as never, selection: "OVER_2_5" },
        ],
      },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    expect(response.output.legs).toHaveLength(1);
    expect(response.output.legs[0]?.selection).toBe("HOME");
    expect(response.output.valueAssessments).toHaveLength(2);
    expect(response.output.eligibleForValidation).toBe(true);
  });

  it("marks eligibleForValidation false when nothing qualifies", async () => {
    const engine = new StubDecisionEngine({
      "fixture-1:HOME": buildValueAssessment({ eventId: "fixture-1", marketType: "match_result_1x2", selection: "HOME", calibratedProbability: 0.3, marketOdds: 2.0, expectedValue: -0.4, qualifies: false }),
    });
    const agent = new FootballDecisionAgent({ decisionEngine: engine });
    agent.markReady();
    const response = await agent.execute({
      requestId: "req-1",
      input: { intelligence: fakeIntelligence(), candidateMarkets: [{ eventId: "fixture-1", marketType: "match_result_1x2" as never, selection: "HOME" }] },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    expect(response.output.legs).toHaveLength(0);
    expect(response.output.eligibleForValidation).toBe(false);
  });

  it("never bypasses the Value Engine — every candidate goes through DecisionEngine.assess(), never a value computed inline", async () => {
    let calls = 0;
    const engine: DecisionEngine = {
      assess: async (eventId, marketType, selection) => {
        calls += 1;
        return buildValueAssessment({ eventId, marketType, selection, calibratedProbability: 0.5, marketOdds: 2, expectedValue: 0, qualifies: false });
      },
    };
    const agent = new FootballDecisionAgent({ decisionEngine: engine });
    agent.markReady();
    await agent.execute({
      requestId: "req-1",
      input: { intelligence: fakeIntelligence(), candidateMarkets: [{ eventId: "fixture-1", marketType: "match_result_1x2" as never, selection: "HOME" }] },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    expect(calls).toBe(1);
  });

  it("surfaces a typed failure when the Value Engine is genuinely unavailable, never a fabricated proposal (adversarial: Section 07 boundary)", async () => {
    const agent = new FootballDecisionAgent({ decisionEngine: new NotImplementedDecisionEngine() });
    agent.markReady();
    await expect(
      agent.execute({
        requestId: "req-1",
        input: { intelligence: fakeIntelligence(), candidateMarkets: [{ eventId: "fixture-1", marketType: "match_result_1x2" as never, selection: "HOME" }] },
        audit: { requestId: "req-1", actor: "user-1" },
      }),
    ).rejects.toThrow(/not implemented/i);
  });

  it("never claims a proposal is an executed ticket — the output type has no stake/execution fields", async () => {
    const engine = new StubDecisionEngine({});
    const agent = new FootballDecisionAgent({ decisionEngine: engine });
    agent.markReady();
    const response = await agent.execute({ requestId: "req-1", input: { intelligence: fakeIntelligence(), candidateMarkets: [] }, audit: { requestId: "req-1", actor: "user-1" } });
    expect(Object.keys(response.output)).not.toContain("stake");
    expect(Object.keys(response.output)).not.toContain("executedAt");
  });
});
