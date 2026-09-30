import { describe, expect, it } from "vitest";
import { GlobalDailyRiskController } from "./global-daily-risk-controller.js";
import { evaluateAviatorDailyRisk, evaluateTicketRisk, RiskCode, type TicketRiskInput, type TicketRiskLegInput, type TicketRiskLimits } from "./ticket-risk-engine.js";

const NOW = "2026-01-10T18:00:00Z";
const FIXTURE_ID = "11111111-1111-1111-1111-111111111111";
const COMPETITION_ID = "22222222-2222-2222-2222-222222222222";

function limits(overrides: Partial<TicketRiskLimits> = {}): TicketRiskLimits {
  return {
    maxStake: 100,
    maxDailyExposure: 500,
    maxTicketsPerDay: 10,
    maxAccumulatorLegs: 5,
    minimumDataQuality: ["AVAILABLE"],
    minimumModelAgreementRatio: undefined,
    restrictedCompetitionIds: [],
    restrictedMarketTypes: [],
    policyVersion: "risk-policy-test-v1",
    ...overrides,
  };
}

function leg(overrides: Partial<TicketRiskLegInput> = {}): TicketRiskLegInput {
  return {
    fixtureId: FIXTURE_ID,
    competitionId: COMPETITION_ID,
    marketType: "match_result_1x2",
    correlationGroup: undefined,
    ...overrides,
  };
}

function input(overrides: Partial<TicketRiskInput> = {}): TicketRiskInput {
  return {
    ticketId: "33333333-3333-3333-3333-333333333333",
    legs: [leg()],
    proposedStake: 10,
    dailyStakeSoFar: 0,
    dailyTicketCountSoFar: 0,
    worstDataQuality: "AVAILABLE",
    modelAgreementRatio: undefined,
    ...overrides,
  };
}

describe("evaluateTicketRisk", () => {
  it("approves a ticket that satisfies every configured limit", () => {
    const result = evaluateTicketRisk(input(), limits(), NOW);
    expect(result.approved).toBe(true);
    expect(result.riskCode).toBe(RiskCode.APPROVED);
    expect(result.reasons).toEqual([]);
  });

  it("rejects when the proposed stake exceeds the max single-ticket stake", () => {
    const result = evaluateTicketRisk(input({ proposedStake: 150 }), limits(), NOW);
    expect(result.approved).toBe(false);
    expect(result.reasons).toContain(RiskCode.MAX_STAKE_EXCEEDED);
  });

  it("rejects when the projected daily exposure would exceed the max", () => {
    const result = evaluateTicketRisk(input({ proposedStake: 50, dailyStakeSoFar: 480 }), limits(), NOW);
    expect(result.approved).toBe(false);
    expect(result.reasons).toContain(RiskCode.MAX_DAILY_EXPOSURE_EXCEEDED);
    expect(result.exposure.projectedDailyStake).toBe(530);
  });

  it("rejects when the projected daily ticket count would exceed the max", () => {
    const result = evaluateTicketRisk(input({ dailyTicketCountSoFar: 10 }), limits({ maxTicketsPerDay: 10 }), NOW);
    expect(result.approved).toBe(false);
    expect(result.reasons).toContain(RiskCode.MAX_TICKETS_PER_DAY_EXCEEDED);
    expect(result.exposure.projectedDailyTicketCount).toBe(11);
  });

  it("rejects an accumulator exceeding the max leg count", () => {
    const legs = Array.from({ length: 6 }, () => leg());
    const result = evaluateTicketRisk(input({ legs }), limits({ maxAccumulatorLegs: 5 }), NOW);
    expect(result.approved).toBe(false);
    expect(result.reasons).toContain(RiskCode.MAX_ACCUMULATOR_LEGS_EXCEEDED);
  });

  it("rejects a ticket containing a leg from a restricted competition", () => {
    const result = evaluateTicketRisk(input(), limits({ restrictedCompetitionIds: [COMPETITION_ID] }), NOW);
    expect(result.approved).toBe(false);
    expect(result.reasons).toContain(RiskCode.LEAGUE_RESTRICTED);
  });

  it("rejects a ticket containing a restricted market type", () => {
    const result = evaluateTicketRisk(input({ legs: [leg({ marketType: "correct_score" })] }), limits({ restrictedMarketTypes: ["correct_score"] }), NOW);
    expect(result.approved).toBe(false);
    expect(result.reasons).toContain(RiskCode.MARKET_RESTRICTED);
  });

  it("rejects a ticket whose worst data quality falls below the configured minimum", () => {
    const result = evaluateTicketRisk(input({ worstDataQuality: "LOW_CONFIDENCE" }), limits({ minimumDataQuality: ["AVAILABLE"] }), NOW);
    expect(result.approved).toBe(false);
    expect(result.reasons).toContain(RiskCode.DATA_QUALITY_BELOW_MINIMUM);
  });

  it("rejects a ticket whose model agreement ratio is below the configured minimum", () => {
    const result = evaluateTicketRisk(input({ modelAgreementRatio: 0.3 }), limits({ minimumModelAgreementRatio: 0.5 }), NOW);
    expect(result.approved).toBe(false);
    expect(result.reasons).toContain(RiskCode.MODEL_AGREEMENT_BELOW_MINIMUM);
  });

  it("does not reject on model agreement when no minimum is configured", () => {
    const result = evaluateTicketRisk(input({ modelAgreementRatio: 0.1 }), limits({ minimumModelAgreementRatio: undefined }), NOW);
    expect(result.reasons).not.toContain(RiskCode.MODEL_AGREEMENT_BELOW_MINIMUM);
  });

  it("collects every violated limit simultaneously, not just the first", () => {
    const legs = Array.from({ length: 6 }, () => leg({ competitionId: COMPETITION_ID }));
    const result = evaluateTicketRisk(
      input({ legs, proposedStake: 200, dailyStakeSoFar: 480, dailyTicketCountSoFar: 10, worstDataQuality: "LOW_CONFIDENCE" }),
      limits({ restrictedCompetitionIds: [COMPETITION_ID] }),
      NOW,
    );
    expect(result.approved).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        RiskCode.MAX_STAKE_EXCEEDED,
        RiskCode.MAX_DAILY_EXPOSURE_EXCEEDED,
        RiskCode.MAX_TICKETS_PER_DAY_EXCEEDED,
        RiskCode.MAX_ACCUMULATOR_LEGS_EXCEEDED,
        RiskCode.LEAGUE_RESTRICTED,
        RiskCode.DATA_QUALITY_BELOW_MINIMUM,
      ]),
    );
    expect(result.reasons.length).toBe(6);
  });

  it("snapshots the exact limits used for the evaluation, for auditability", () => {
    const theLimits = limits({ policyVersion: "audit-test-v2" });
    const result = evaluateTicketRisk(input(), theLimits, NOW);
    expect(result.limitsSnapshot).toEqual(theLimits);
    expect(result.policyVersion).toBe("audit-test-v2");
    expect(result.evaluatedAt).toBe(NOW);
  });

  it("never uses the words guaranteed/safe/risk-free anywhere in its output", () => {
    const result = evaluateTicketRisk(input({ proposedStake: 200 }), limits(), NOW);
    expect(JSON.stringify(result)).not.toMatch(/guarantee|sure.?win|risk.?free/i);
  });
});

describe("evaluateAviatorDailyRisk — reuses the shared GlobalDailyRiskController, never a second one", () => {
  it("reports APPROVED while the controller is ACTIVE", () => {
    const controller = new GlobalDailyRiskController({ dailyTarget: 100, dailyStopLoss: 50 });
    const result = evaluateAviatorDailyRisk(controller, NOW);
    expect(result.approved).toBe(true);
    expect(result.riskCode).toBe(RiskCode.APPROVED);
    expect(result.reasons).toEqual([]);
  });

  it("blocks execution and reports DAILY_TARGET_REACHED once the controller locks in a win", () => {
    const controller = new GlobalDailyRiskController({ dailyTarget: 100, dailyStopLoss: 50 });
    controller.recordResult(120);
    const result = evaluateAviatorDailyRisk(controller, NOW);
    expect(result.approved).toBe(false);
    expect(result.riskCode).toBe(RiskCode.DAILY_TARGET_REACHED);
    expect(result.reasons).toContain(RiskCode.DAILY_TARGET_REACHED);
  });

  it("blocks execution and reports DAILY_STOP_LOSS_REACHED once the controller locks in a loss", () => {
    const controller = new GlobalDailyRiskController({ dailyTarget: 100, dailyStopLoss: 50 });
    controller.recordResult(-60);
    const result = evaluateAviatorDailyRisk(controller, NOW);
    expect(result.approved).toBe(false);
    expect(result.riskCode).toBe(RiskCode.DAILY_STOP_LOSS_REACHED);
    expect(result.reasons).toContain(RiskCode.DAILY_STOP_LOSS_REACHED);
  });

  it("never constructs its own controller — reads whatever state the shared instance is actually in", () => {
    const controller = new GlobalDailyRiskController({ dailyTarget: 100, dailyStopLoss: 50 });
    controller.recordResult(30);
    const midDayResult = evaluateAviatorDailyRisk(controller, NOW);
    expect(midDayResult.approved).toBe(true);
    expect(midDayResult.exposure.projectedDailyStake).toBe(30);

    controller.recordResult(80); // cumulative 110 >= target 100
    const afterTargetResult = evaluateAviatorDailyRisk(controller, NOW);
    expect(afterTargetResult.approved).toBe(false);
    expect(afterTargetResult.riskCode).toBe(RiskCode.DAILY_TARGET_REACHED);
  });
});
