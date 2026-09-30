import { buildDefaultDoubleBetLegs, combineDoubleBetLegs, settleDoubleBet, settleDoubleBetLeg, type DoubleBetRecord } from "@sport-os/aviator-engine";
import { createTicketDraft, DecisionOutcome, settleTicket, ticketLegFromValueAssessment, ValueEligibility, VALUE_CALCULATION_VERSION, type ValueAssessment } from "@sport-os/football-engine";
import { MarketType } from "@sport-os/market-engine";
import { LedgerMode, PayoutSource, type Money } from "@sport-os/settlement-engine";
import { generateId } from "@sport-os/shared";
import { describe, expect, it } from "vitest";
import { PerformanceAgent } from "./performance-agent.js";

const FIXTURE_ID = "55555555-5555-5555-5555-555555555555";
const NOW = "2026-02-01T20:00:00Z";

function betAssessment(overrides: Partial<ValueAssessment> = {}): ValueAssessment {
  return {
    eventId: FIXTURE_ID,
    marketType: MarketType.MATCH_RESULT_1X2,
    selection: "HOME",
    line: undefined,
    calibratedProbability: 0.6,
    marketOdds: 2.0,
    fairOdds: 1 / 0.6,
    edge: 0.1,
    expectedValue: 0.2,
    dataQuality: "AVAILABLE",
    oddsTimestamp: NOW,
    modelVersion: "model-v1",
    calculationVersion: VALUE_CALCULATION_VERSION,
    eligibility: ValueEligibility.VALID,
    decision: DecisionOutcome.BET,
    reasons: [],
    evaluatedAt: NOW,
    qualifies: true,
    ...overrides,
  };
}

function settledDoubleBet(target1Exit: number, target2Exit: number, totalStake = 100): DoubleBetRecord {
  const { target1, target2 } = buildDefaultDoubleBetLegs({ totalStake, target1Multiplier: 1.5, target2Multiplier: 3.0 });
  const s1 = settleDoubleBetLeg(target1, target1Exit, "2026-01-01T00:00:00Z");
  const s2 = settleDoubleBetLeg(target2, target2Exit, "2026-01-01T00:00:01Z");
  const combined = combineDoubleBetLegs(s1, s2);
  return { doubleBetId: generateId(), signalId: "sig-1", roundId: "round-1", target1: s1, target2: s2, ...combined, createdAt: "2026-01-01T00:00:00Z" };
}

function openDoubleBet(): DoubleBetRecord {
  const { target1, target2 } = buildDefaultDoubleBetLegs({ totalStake: 100, target1Multiplier: 1.5, target2Multiplier: 3.0 });
  return { doubleBetId: generateId(), signalId: "sig-2", roundId: "round-2", target1, target2, totalStake: 100, totalReturn: undefined, netPnl: undefined, roi: undefined, createdAt: "2026-01-01T00:00:00Z" };
}

describe("PerformanceAgent", () => {
  it("aggregates real, non-fabricated P&L from settled double bets", async () => {
    const agent = new PerformanceAgent();
    agent.markReady();
    // A win (both legs cash out at target): stake 100, return 75+150=225, pnl +125.
    const bet = settledDoubleBet(1.5, 3.0);
    const response = await agent.execute({ requestId: "req-1", input: { periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-01-07T23:59:59Z", doubleBets: [bet] }, audit: { requestId: "req-1", actor: "user-1" } });
    expect(response.output.aviator.totalStaked).toBe(100);
    expect(response.output.aviator.netPnl).toBe(125);
    expect(response.output.aviator.roi).toBeCloseTo(1.25);
  });

  it("excludes still-open (unsettled) double bets from the money math, never treats them as a zero outcome", async () => {
    const agent = new PerformanceAgent();
    agent.markReady();
    const response = await agent.execute({ requestId: "req-1", input: { periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-01-07T23:59:59Z", doubleBets: [openDoubleBet()] }, audit: { requestId: "req-1", actor: "user-1" } });
    expect(response.output.aviator.totalDoubleBets).toBe(1);
    expect(response.output.aviator.settledDoubleBets).toBe(0);
    expect(response.output.aviator.netPnl).toBeNull();
    expect(response.output.aviator.roi).toBeNull();
  });

  it("computes max drawdown and longest losing streak over the settled P&L sequence", async () => {
    const agent = new PerformanceAgent();
    agent.markReady();
    // Sequence of net P&L: +50, -30, -30, -30, +10 (both legs crash for the losses)
    const win1 = settledDoubleBet(1.5, 3.0, 100); // both hit target: pnl = (75-50)+(150-50)=125... let's just use full losses/wins for clarity below instead.
    void win1;
    const loss = () => {
      const { target1, target2 } = buildDefaultDoubleBetLegs({ totalStake: 20, target1Multiplier: 1.5, target2Multiplier: 3.0 });
      const s1 = settleDoubleBetLeg(target1, null, "2026-01-01T00:00:00Z");
      const s2 = settleDoubleBetLeg(target2, null, "2026-01-01T00:00:01Z");
      const combined = combineDoubleBetLegs(s1, s2);
      return { doubleBetId: generateId(), signalId: "sig-1", roundId: "round-x", target1: s1, target2: s2, ...combined, createdAt: "2026-01-01T00:00:00Z" } as DoubleBetRecord;
    };
    const bets = [loss(), loss(), loss()]; // 3 consecutive full losses of -20 each
    const response = await agent.execute({ requestId: "req-1", input: { periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-01-07T23:59:59Z", doubleBets: bets }, audit: { requestId: "req-1", actor: "user-1" } });
    expect(response.output.aviator.longestLosingStreak).toBe(3);
    expect(response.output.aviator.maxDrawdown).toBe(60);
  });

  it("never rewrites the historical outcomes it's given — the input records are passed through unmutated", async () => {
    const agent = new PerformanceAgent();
    agent.markReady();
    const bet = settledDoubleBet(1.5, 3.0);
    const snapshot = JSON.parse(JSON.stringify(bet));
    await agent.execute({ requestId: "req-1", input: { periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-01-07T23:59:59Z", doubleBets: [bet] }, audit: { requestId: "req-1", actor: "user-1" } });
    expect(bet).toEqual(snapshot);
  });

  it("Section 08: aggregates a real football performance ledger entry from settled TicketSettlements, never fabricating missing values", async () => {
    const leg = ticketLegFromValueAssessment(betAssessment());
    const ticket = createTicketDraft({ legs: [leg], createdBy: "user-1", now: () => NOW });
    const stake: Money = { amount: 100, currency: "NGN" };
    const payout: Money = { amount: 200, currency: "NGN" };
    const settlement = settleTicket({
      ticket,
      results: new Map([[FIXTURE_ID, { resultVersionId: "result-v1", homeGoals: 1, awayGoals: 0, halftimeHomeGoals: 0, halftimeAwayGoals: 0 }]]),
      execution: { stake, payout, payoutSource: PayoutSource.PROVIDER },
      ledgerMode: LedgerMode.LIVE,
      source: "test",
      now: NOW,
    });

    const agent = new PerformanceAgent();
    agent.markReady();
    const response = await agent.execute({
      requestId: "req-1",
      input: { periodStart: "2026-02-01T00:00:00Z", periodEnd: "2026-02-28T00:00:00Z", doubleBets: [], footballSettlements: [settlement], ledgerMode: LedgerMode.LIVE },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    expect(response.output.footballLedger).toBeDefined();
    expect(response.output.footballLedger?.sport).toBe("football");
    expect(response.output.footballLedger?.wins).toBe(1);
    expect(response.output.footballLedger?.actualPnl).toEqual({ amount: 100, currency: "NGN" });
  });

  it("Section 08: aviatorLedger/footballLedger are undefined (never a fabricated empty entry) when no settlements are supplied", async () => {
    const agent = new PerformanceAgent();
    agent.markReady();
    const response = await agent.execute({ requestId: "req-1", input: { periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-01-07T23:59:59Z", doubleBets: [] }, audit: { requestId: "req-1", actor: "user-1" } });
    expect(response.output.aviatorLedger).toBeUndefined();
    expect(response.output.footballLedger).toBeUndefined();
  });

  it("Section 08: aggregates a real Aviator performance ledger entry from settled DoubleBetSettlements", async () => {
    const bet = settledDoubleBet(1.5, 3.0);
    const settlement = settleDoubleBet(bet, { currency: "NGN", ledgerMode: LedgerMode.LIVE, source: "test", now: NOW });

    const agent = new PerformanceAgent();
    agent.markReady();
    const response = await agent.execute({
      requestId: "req-1",
      input: { periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-01-07T23:59:59Z", doubleBets: [], doubleBetSettlements: [settlement], ledgerMode: LedgerMode.LIVE },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    expect(response.output.aviatorLedger).toBeDefined();
    expect(response.output.aviatorLedger?.sport).toBe("aviator");
    expect(response.output.aviatorLedger?.sampleSize).toBe(1);
  });
});
