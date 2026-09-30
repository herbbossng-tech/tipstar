import { MarketStatus, MarketType, type MarketObservation } from "@sport-os/market-engine";
import { describe, expect, it } from "vitest";
import { applyRiskRejection, DecisionOutcome, DecisionReasonCode, evaluateValue, StandardDecisionEngine, ValueEligibility, type DecisionPolicy, type PredictionSnapshot, type ValueEngineDependencies } from "./decision.js";

const FIXTURE_ID = "11111111-1111-1111-1111-111111111111";
const NOW = "2026-01-10T18:00:00Z";

function policy(overrides: Partial<DecisionPolicy> = {}): DecisionPolicy {
  return {
    minimumEdge: 0.02,
    minimumExpectedValue: 0,
    minimumDataQuality: ["AVAILABLE"],
    minimumModelAgreementRatio: undefined,
    oddsValidity: { maxOddsAgeSeconds: 120 },
    policyVersion: "policy-test-v1",
    ...overrides,
  };
}

function snapshot(overrides: Partial<PredictionSnapshot> = {}): PredictionSnapshot {
  return {
    fixtureId: FIXTURE_ID,
    snapshotTime: NOW,
    modelVersion: "model-test-v1",
    dataQuality: "AVAILABLE",
    probabilityInputs: { probability1x2: { home: 0.6, draw: 0.25, away: 0.15 } },
    ...overrides,
  };
}

function observation(overrides: Partial<MarketObservation> = {}): MarketObservation {
  return {
    marketId: "obs-1",
    marketType: MarketType.MATCH_RESULT_1X2,
    fixtureId: FIXTURE_ID,
    selection: "HOME",
    line: undefined,
    odds: 2.0,
    oddsTimestamp: "2026-01-10T17:59:00Z",
    source: "test-bookmaker",
    sourceObservationId: undefined,
    status: MarketStatus.OPEN,
    schemaVersion: 1,
    ...overrides,
  };
}

function deps(snap: PredictionSnapshot | undefined, obs: MarketObservation | undefined): ValueEngineDependencies {
  return {
    getPredictionSnapshot: async () => snap,
    getMarketObservation: async () => obs,
  };
}

describe("evaluateValue — Value Engine", () => {
  it("computes real fair odds, edge, and EV from a valid probability + valid odds", async () => {
    const result = await evaluateValue(deps(snapshot(), observation({ odds: 2.0 })), { eventId: FIXTURE_ID, marketType: MarketType.MATCH_RESULT_1X2, selection: "HOME", now: NOW }, policy());
    expect(result.calibratedProbability).toBe(0.6);
    expect(result.fairOdds).toBeCloseTo(1 / 0.6, 4);
    // implied probability = 1/2.0 = 0.5; edge = 0.6 - 0.5 = 0.1
    expect(result.edge).toBeCloseTo(0.1, 6);
    // EV = 0.6*2.0 - 1 = 0.2
    expect(result.expectedValue).toBeCloseTo(0.2, 6);
    expect(result.eligibility).toBe(ValueEligibility.VALID);
    expect(result.decision).toBe(DecisionOutcome.BET);
    expect(result.qualifies).toBe(true);
  });

  it("never calls EV/edge 'guaranteed' or 'safe' anywhere in the type or reasons — structural check that no such field exists", async () => {
    const result = await evaluateValue(deps(snapshot(), observation()), { eventId: FIXTURE_ID, marketType: MarketType.MATCH_RESULT_1X2, selection: "HOME", now: NOW }, policy());
    expect(Object.keys(result)).not.toContain("guaranteed");
    expect(Object.keys(result)).not.toContain("safe");
    expect(JSON.stringify(result)).not.toMatch(/guarantee|sure.?win|risk.?free/i);
  });

  it("returns PREDICTION_UNAVAILABLE / INSUFFICIENT_DATA when no prediction exists — never fabricates one", async () => {
    const result = await evaluateValue(deps(undefined, observation()), { eventId: FIXTURE_ID, marketType: MarketType.MATCH_RESULT_1X2, selection: "HOME", now: NOW }, policy());
    expect(result.eligibility).toBe(ValueEligibility.PREDICTION_UNAVAILABLE);
    expect(result.decision).toBe(DecisionOutcome.INSUFFICIENT_DATA);
    expect(result.calibratedProbability).toBeNull();
    expect(result.qualifies).toBe(false);
  });

  it("returns MARKET_UNSUPPORTED when the market cannot be derived from the prediction (e.g. BTTS with no btts data)", async () => {
    const result = await evaluateValue(deps(snapshot(), observation({ marketType: MarketType.BOTH_TEAMS_TO_SCORE, selection: "YES" })), { eventId: FIXTURE_ID, marketType: MarketType.BOTH_TEAMS_TO_SCORE, selection: "YES", now: NOW }, policy());
    expect(result.eligibility).toBe(ValueEligibility.MARKET_UNSUPPORTED);
    expect(result.decision).toBe(DecisionOutcome.MARKET_UNSUPPORTED);
    expect(result.reasons).toContain(DecisionReasonCode.MARKET_UNSUPPORTED);
  });

  it("returns WAIT with ODDS_MISSING when no market observation exists at all — never computes value from nothing", async () => {
    const result = await evaluateValue(deps(snapshot(), undefined), { eventId: FIXTURE_ID, marketType: MarketType.MATCH_RESULT_1X2, selection: "HOME", now: NOW }, policy());
    expect(result.decision).toBe(DecisionOutcome.WAIT);
    expect(result.reasons).toContain(DecisionReasonCode.ODDS_MISSING);
    expect(result.expectedValue).toBeNull();
    expect(result.edge).toBeNull();
  });

  it("returns WAIT with ODDS_STALE for odds older than the configured freshness threshold — never computes value from stale odds", async () => {
    const staleObservation = observation({ oddsTimestamp: "2026-01-10T17:00:00Z" }); // 60 minutes before NOW, threshold is 120s
    const result = await evaluateValue(deps(snapshot(), staleObservation), { eventId: FIXTURE_ID, marketType: MarketType.MATCH_RESULT_1X2, selection: "HOME", now: NOW }, policy());
    expect(result.decision).toBe(DecisionOutcome.WAIT);
    expect(result.reasons).toContain(DecisionReasonCode.ODDS_STALE);
    expect(result.expectedValue).toBeNull();
  });

  it("returns WAIT with MARKET_SUSPENDED for a suspended market — never creates a valid execution request", async () => {
    const suspended = observation({ status: MarketStatus.SUSPENDED });
    const result = await evaluateValue(deps(snapshot(), suspended), { eventId: FIXTURE_ID, marketType: MarketType.MATCH_RESULT_1X2, selection: "HOME", now: NOW }, policy());
    expect(result.reasons).toContain(DecisionReasonCode.MARKET_SUSPENDED);
    expect(result.decision).toBe(DecisionOutcome.WAIT);
  });

  it("returns NO_EDGE when edge is below the configured threshold, even with positive raw EV", async () => {
    // probability 0.52 vs odds 2.0 (implied 0.5) => edge 0.02, right at threshold boundary; use 0.51 to go below.
    const marginalSnapshot = snapshot({ probabilityInputs: { probability1x2: { home: 0.51, draw: 0.3, away: 0.19 } } });
    const result = await evaluateValue(deps(marginalSnapshot, observation({ odds: 2.0 })), { eventId: FIXTURE_ID, marketType: MarketType.MATCH_RESULT_1X2, selection: "HOME", now: NOW }, policy({ minimumEdge: 0.05 }));
    expect(result.decision).toBe(DecisionOutcome.NO_EDGE);
    expect(result.reasons).toContain(DecisionReasonCode.EDGE_BELOW_THRESHOLD);
  });

  it("returns INSUFFICIENT_DATA when data quality does not meet the configured minimum, even with strong edge/EV", async () => {
    const lowQuality = snapshot({ dataQuality: "LOW_CONFIDENCE" });
    const result = await evaluateValue(deps(lowQuality, observation({ odds: 3.0 })), { eventId: FIXTURE_ID, marketType: MarketType.MATCH_RESULT_1X2, selection: "HOME", now: NOW }, policy({ minimumDataQuality: ["AVAILABLE"] }));
    expect(result.decision).toBe(DecisionOutcome.INSUFFICIENT_DATA);
    expect(result.reasons).toContain(DecisionReasonCode.DATA_QUALITY_LOW);
  });

  it("returns NO_TRADE when model agreement is below the configured minimum", async () => {
    const disagreeing = snapshot({ modelAgreementRatio: 0.2 });
    const result = await evaluateValue(deps(disagreeing, observation({ odds: 3.0 })), { eventId: FIXTURE_ID, marketType: MarketType.MATCH_RESULT_1X2, selection: "HOME", now: NOW }, policy({ minimumModelAgreementRatio: 0.5 }));
    expect(result.decision).toBe(DecisionOutcome.NO_TRADE);
    expect(result.reasons).toContain(DecisionReasonCode.MODEL_DISAGREEMENT);
  });
});

describe("applyRiskRejection — value and risk remain separate outputs (§21)", () => {
  it("converts a BET decision to RISK_REJECTED when risk denies it", async () => {
    const bet = await evaluateValue(deps(snapshot(), observation({ odds: 3.0 })), { eventId: FIXTURE_ID, marketType: MarketType.MATCH_RESULT_1X2, selection: "HOME", now: NOW }, policy());
    expect(bet.decision).toBe(DecisionOutcome.BET);
    const rejected = applyRiskRejection(bet, false, DecisionReasonCode.DAILY_STOP_LOSS);
    expect(rejected.decision).toBe(DecisionOutcome.RISK_REJECTED);
    expect(rejected.qualifies).toBe(false);
    expect(rejected.reasons).toContain(DecisionReasonCode.DAILY_STOP_LOSS);
    // The underlying value figures are UNCHANGED by risk rejection — value and risk are separate.
    expect(rejected.expectedValue).toBe(bet.expectedValue);
    expect(rejected.edge).toBe(bet.edge);
  });

  it("a non-BET decision is returned unchanged regardless of risk approval — risk approval never manufactures value", async () => {
    const noEdge = await evaluateValue(deps(snapshot(), observation({ odds: 1.6 })), { eventId: FIXTURE_ID, marketType: MarketType.MATCH_RESULT_1X2, selection: "HOME", now: NOW }, policy({ minimumEdge: 0.5 }));
    expect(noEdge.decision).not.toBe(DecisionOutcome.BET);
    const stillNoEdge = applyRiskRejection(noEdge, true);
    expect(stillNoEdge).toEqual(noEdge);
  });

  it("a risk-approved BET decision is untouched", async () => {
    const bet = await evaluateValue(deps(snapshot(), observation({ odds: 3.0 })), { eventId: FIXTURE_ID, marketType: MarketType.MATCH_RESULT_1X2, selection: "HOME", now: NOW }, policy());
    const approved = applyRiskRejection(bet, true);
    expect(approved).toEqual(bet);
  });
});

describe("StandardDecisionEngine — DecisionEngine interface compatibility", () => {
  it("assess() delegates correctly and satisfies the existing DecisionEngine interface used by @sport-os/agents' Football Decision Agent", async () => {
    const engine = new StandardDecisionEngine(deps(snapshot(), observation({ odds: 3.0 })), policy(), () => NOW);
    const result = await engine.assess(FIXTURE_ID, MarketType.MATCH_RESULT_1X2, "HOME");
    expect(result.qualifies).toBe(true);
    expect(result.decision).toBe(DecisionOutcome.BET);
  });
});
