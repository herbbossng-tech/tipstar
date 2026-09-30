import { MarketType } from "@sport-os/market-engine";
import { LedgerMode, SettlementStatus } from "@sport-os/settlement-engine";
import { ValidationError } from "@sport-os/shared";
import { describe, expect, it } from "vitest";
import type { TrainingExample } from "./dataset/types.js";
import type { DecisionPolicy } from "./decision.js";
import { backtestToPerformanceRecordInput, computeBacktestPredictiveMetrics, simulateBacktestDecision, type BacktestDecisionPoint } from "./backtest.js";

const FIXTURE_ID = "11111111-1111-1111-1111-111111111111";
const COMPETITION_ID = "22222222-2222-2222-2222-222222222222";
const SNAPSHOT_TIME = "2026-01-10T17:00:00Z";

function example(overrides: Partial<TrainingExample> = {}): TrainingExample {
  return {
    fixtureId: FIXTURE_ID,
    competitionId: COMPETITION_ID,
    seasonId: undefined,
    kickoffTime: "2026-01-10T19:00:00Z",
    snapshotTime: SNAPSHOT_TIME,
    features: {},
    target1x2: "HOME",
    targetTotalGoals: 3,
    targetBtts: true,
    datasetVersion: "backtest-fixture-v1",
    builtAt: SNAPSHOT_TIME,
    ...overrides,
  };
}

function policy(overrides: Partial<DecisionPolicy> = {}): DecisionPolicy {
  return { minimumEdge: 0.02, minimumExpectedValue: 0, minimumDataQuality: ["AVAILABLE"], minimumModelAgreementRatio: undefined, oddsValidity: { maxOddsAgeSeconds: 3600 }, policyVersion: "backtest-policy-v1", ...overrides };
}

function point(overrides: Partial<BacktestDecisionPoint> = {}): BacktestDecisionPoint {
  return {
    example: example(),
    prediction: { probability1x2: { home: 0.6, draw: 0.25, away: 0.15 } },
    marketType: MarketType.MATCH_RESULT_1X2,
    selection: "HOME",
    line: undefined,
    decisionOdds: 2.0,
    oddsTimestamp: SNAPSHOT_TIME,
    modelVersion: "model-backtest-v1",
    dataQuality: "AVAILABLE",
    ...overrides,
  };
}

const SIM_PARAMS = { policy: policy(), stakePerTicket: 100, currency: "NGN", source: "backtest", now: () => "2026-01-10T18:00:00Z" };

describe("simulateBacktestDecision", () => {
  it("settles a BET decision as WON when the historical label matches the selection", async () => {
    const result = await simulateBacktestDecision(point({ example: example({ target1x2: "HOME" }), selection: "HOME" }), SIM_PARAMS);
    expect(result.valueAssessment.decision).toBe("BET");
    expect(result.ticket).toBeDefined();
    expect(result.settlement?.status).toBe(SettlementStatus.WON);
    expect(result.settlement?.ledgerMode).toBe(LedgerMode.PAPER);
    expect(result.settlement?.calculatedReturn).toEqual({ amount: 200, currency: "NGN" });
    expect(result.settlement?.netPnl).toEqual({ amount: 100, currency: "NGN" });
  });

  it("settles a BET decision as LOST when the historical label does not match", async () => {
    const result = await simulateBacktestDecision(point({ example: example({ target1x2: "AWAY" }), selection: "HOME" }), SIM_PARAMS);
    expect(result.settlement?.status).toBe(SettlementStatus.LOST);
    expect(result.settlement?.calculatedReturn).toEqual({ amount: 0, currency: "NGN" });
    expect(result.settlement?.netPnl).toEqual({ amount: -100, currency: "NGN" });
  });

  it("produces no ticket/settlement when the Value Engine's own decision is not BET", async () => {
    // minimumEdge set impossibly high -> NO_EDGE, never a ticket.
    const result = await simulateBacktestDecision(point(), { ...SIM_PARAMS, policy: policy({ minimumEdge: 0.99 }) });
    expect(result.valueAssessment.decision).not.toBe("BET");
    expect(result.ticket).toBeUndefined();
    expect(result.settlement).toBeUndefined();
  });

  it("grades Over/Under from the historical targetTotalGoals label", async () => {
    const overPoint = point({ example: example({ targetTotalGoals: 4 }), marketType: MarketType.OVER_UNDER, selection: "OVER", line: 2.5, prediction: { probability1x2: { home: 0.3, draw: 0.2, away: 0.5 }, overUnder: { "2.5": { yes: 0.7, no: 0.3 } } } });
    const result = await simulateBacktestDecision(overPoint, SIM_PARAMS);
    expect(result.settlement?.status).toBe(SettlementStatus.WON);
  });

  it("grades BTTS from the historical targetBtts label", async () => {
    const bttsPoint = point({ example: example({ targetBtts: false }), marketType: MarketType.BOTH_TEAMS_TO_SCORE, selection: "NO", prediction: { probability1x2: { home: 0.3, draw: 0.2, away: 0.5 }, btts: { yes: 0.3, no: 0.7 } } });
    const result = await simulateBacktestDecision(bttsPoint, SIM_PARAMS);
    expect(result.settlement?.status).toBe(SettlementStatus.WON);
  });

  it("throws BACKTEST_FUTURE_ODDS when the odds timestamp is after the decision's snapshotTime — a leakage bug, not a warning (§32)", async () => {
    const futureOddsPoint = point({ oddsTimestamp: "2026-01-10T18:00:00Z" }); // after SNAPSHOT_TIME (17:00)
    await expect(simulateBacktestDecision(futureOddsPoint, SIM_PARAMS)).rejects.toThrow(ValidationError);
    await expect(simulateBacktestDecision(futureOddsPoint, SIM_PARAMS)).rejects.toThrow(/BACKTEST_FUTURE_ODDS|future|snapshotTime/i);
  });

  it("computes closing-line value when closing odds are supplied, undefined otherwise", async () => {
    const withClosing = await simulateBacktestDecision(point({ closingOdds: 1.8 }), SIM_PARAMS);
    expect(withClosing.closingLineValue).toBeCloseTo(2.0 / 1.8 - 1, 6);

    const withoutClosing = await simulateBacktestDecision(point(), SIM_PARAMS);
    expect(withoutClosing.closingLineValue).toBeUndefined();
  });

  it("never labels a backtest's own calculated return as PayoutSource.PROVIDER — every backtest is PAPER", async () => {
    const result = await simulateBacktestDecision(point(), SIM_PARAMS);
    expect(result.settlement?.ledgerMode).toBe(LedgerMode.PAPER);
  });
});

describe("backtestToPerformanceRecordInput", () => {
  it("returns undefined when the simulation produced no settlement", async () => {
    const result = await simulateBacktestDecision(point(), { ...SIM_PARAMS, policy: policy({ minimumEdge: 0.99 }) });
    expect(backtestToPerformanceRecordInput(result)).toBeUndefined();
  });

  it("maps a real settlement into the shared PerformanceRecordInput shape", async () => {
    const result = await simulateBacktestDecision(point(), SIM_PARAMS);
    const input = backtestToPerformanceRecordInput(result);
    expect(input?.ledgerMode).toBe(LedgerMode.PAPER);
    expect(input?.legCount).toBe(1);
    expect(input?.actualStake).toEqual({ amount: 100, currency: "NGN" });
    expect(input?.expectedEv).toBeCloseTo(result.valueAssessment.expectedValue!, 6);
  });
});

describe("computeBacktestPredictiveMetrics", () => {
  it("computes real accuracy/logLoss/brierScore over the 1X2 decision points, reusing Section 05's evaluation metrics", () => {
    const points: BacktestDecisionPoint[] = [
      point({ example: example({ target1x2: "HOME" }) }),
      point({ example: example({ target1x2: "AWAY" }) }),
    ];
    const metrics = computeBacktestPredictiveMetrics(points);
    expect(metrics.sampleCount).toBe(2);
    expect(metrics.accuracy).not.toBeNull();
    expect(metrics.logLoss).not.toBeNull();
    expect(metrics.brierScore).not.toBeNull();
  });

  it("returns null metrics (never NaN/0) when there are zero 1X2 decision points", () => {
    const overOnlyPoints: BacktestDecisionPoint[] = [point({ marketType: MarketType.OVER_UNDER, selection: "OVER", line: 2.5 })];
    const metrics = computeBacktestPredictiveMetrics(overOnlyPoints);
    expect(metrics.sampleCount).toBe(0);
    expect(metrics.accuracy).toBeNull();
    expect(metrics.logLoss).toBeNull();
    expect(metrics.brierScore).toBeNull();
  });
});
