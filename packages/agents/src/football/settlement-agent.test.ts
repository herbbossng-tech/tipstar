import { createTicketDraft, DecisionOutcome, ticketLegFromValueAssessment, ValueEligibility, VALUE_CALCULATION_VERSION, type ValueAssessment } from "@sport-os/football-engine";
import { MarketType } from "@sport-os/market-engine";
import { LedgerMode, PayoutSource, SettlementStatus, type MatchResult, type Money, type Settlement, type SettlementService, type Ticket } from "@sport-os/settlement-engine";
import { describe, expect, it } from "vitest";
import { SettlementAgent } from "./settlement-agent.js";

const NOW = "2026-02-01T20:00:00Z";
const FIXTURE_ID = "44444444-4444-4444-4444-444444444444";

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

function ticket(): Ticket {
  return { ticketId: "22222222-2222-2222-2222-222222222222", selections: [{ selectionId: "s1", eventId: "fixture-1", market: "match_result_1x2", selection: "HOME", oddsAtPublication: 2.0 }], publishedAt: "2026-01-10T18:00:00Z" };
}

class StubSettlementService implements SettlementService {
  async settle(ticketId: string, _result: MatchResult): Promise<Settlement> {
    return { settlementId: "s1", ticketId, status: SettlementStatus.WON, settledAt: new Date().toISOString() };
  }
}

describe("SettlementAgent", () => {
  it("delegates settlement math to SettlementService and never computes an outcome itself", async () => {
    const agent = new SettlementAgent({ settlementService: new StubSettlementService() });
    agent.markReady();
    const response = await agent.execute({
      requestId: "req-1",
      input: { ticket: ticket(), executedWager: { ticketId: ticket().ticketId, stake: 10, executedAt: "2026-01-10T18:05:00Z" }, officialResult: { eventId: "fixture-1", finalScore: "2-0", settledAt: "2026-01-10T20:00:00Z" } },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    expect(response.output.settlement.status).toBe(SettlementStatus.WON);
  });

  it("never mutates or rewrites the original ticket/prediction (adversarial test #5)", async () => {
    const agent = new SettlementAgent({ settlementService: new StubSettlementService() });
    agent.markReady();
    const originalTicket = ticket();
    const originalSelectionsSnapshot = JSON.parse(JSON.stringify(originalTicket.selections));
    const response = await agent.execute({
      requestId: "req-1",
      input: { ticket: originalTicket, executedWager: { ticketId: originalTicket.ticketId, stake: 10, executedAt: "2026-01-10T18:05:00Z" }, officialResult: { eventId: "fixture-1", finalScore: "2-0", settledAt: "2026-01-10T20:00:00Z" } },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    // The ORIGINAL object passed in is untouched...
    expect(originalTicket.selections).toEqual(originalSelectionsSnapshot);
    // ...and the response's echoed copy matches it exactly, never a mutated version.
    expect(response.output.originalTicket).toEqual(originalTicket);
    expect(response.output.originalTicket).not.toBe(originalTicket);
  });

  it("an accumulator with multiple legs still settles as exactly ONE settlement record, never one per leg", async () => {
    const multiLegTicket: Ticket = {
      ticketId: "33333333-3333-3333-3333-333333333333",
      selections: [
        { selectionId: "s1", eventId: "fixture-1", market: "match_result_1x2", selection: "HOME", oddsAtPublication: 2.0 },
        { selectionId: "s2", eventId: "fixture-2", market: "match_result_1x2", selection: "AWAY", oddsAtPublication: 1.8 },
        { selectionId: "s3", eventId: "fixture-3", market: "over_under", selection: "OVER_2_5", oddsAtPublication: 1.5 },
      ],
      publishedAt: "2026-01-10T18:00:00Z",
    };
    const agent = new SettlementAgent({ settlementService: new StubSettlementService() });
    agent.markReady();
    const response = await agent.execute({
      requestId: "req-1",
      input: { ticket: multiLegTicket, executedWager: { ticketId: multiLegTicket.ticketId, stake: 10, executedAt: "2026-01-10T18:05:00Z" }, officialResult: { eventId: "fixture-1", finalScore: "2-0", settledAt: "2026-01-10T20:00:00Z" } },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    // One settlement object for the whole (3-leg) ticket — the output shape itself makes "5 lost tickets" impossible to produce.
    expect(response.output.settlement.ticketId).toBe(multiLegTicket.ticketId);
    expect(typeof response.output.settlement).toBe("object");
  });

  it("Section 08: settles a real richTicket via the real football settlement engine — never the legacy stub — and reports financial figures for an executed wager", async () => {
    const leg = ticketLegFromValueAssessment(betAssessment());
    const richTicket = createTicketDraft({ legs: [leg], createdBy: "user-1", now: () => NOW });
    const stake: Money = { amount: 100, currency: "NGN" };
    const payout: Money = { amount: 200, currency: "NGN" };
    const agent = new SettlementAgent({ settlementService: new StubSettlementService() });
    agent.markReady();
    const response = await agent.execute({
      requestId: "req-1",
      input: {
        richTicket,
        footballResults: new Map([[FIXTURE_ID, { resultVersionId: "result-v1", homeGoals: 2, awayGoals: 1, halftimeHomeGoals: 1, halftimeAwayGoals: 0 }]]),
        execution: { stake, payout, payoutSource: PayoutSource.PROVIDER },
        ledgerMode: LedgerMode.LIVE,
      },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    expect(response.output.settlement.status).toBe(SettlementStatus.WON);
    expect(response.output.originalTicket).toBeUndefined();
    expect(response.output.richSettlement).toBeDefined();
    expect(response.output.richSettlement?.actualPayout).toEqual(payout);
    expect(response.output.richSettlement?.netPnl).toEqual({ amount: 100, currency: "NGN" });
    expect(response.output.richSettlement?.roi).toBeCloseTo(1.0, 6);
  });

  it("Section 08: an unexecuted richTicket settles analytically with no financial fields fabricated (§42)", async () => {
    const leg = ticketLegFromValueAssessment(betAssessment());
    const richTicket = createTicketDraft({ legs: [leg], createdBy: "user-1", now: () => NOW });
    const agent = new SettlementAgent({ settlementService: new StubSettlementService() });
    agent.markReady();
    const response = await agent.execute({
      requestId: "req-1",
      input: { richTicket, footballResults: new Map([[FIXTURE_ID, { resultVersionId: "result-v1", homeGoals: 2, awayGoals: 1, halftimeHomeGoals: 1, halftimeAwayGoals: 0 }]]) },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    expect(response.output.richSettlement?.status).toBe(SettlementStatus.WON);
    expect(response.output.richSettlement?.actualStake).toBeNull();
    expect(response.output.richSettlement?.actualPayout).toBeNull();
    expect(response.output.richSettlement?.netPnl).toBeNull();
  });

  it("throws a clear validation error when neither richTicket nor the legacy trio is supplied", async () => {
    const agent = new SettlementAgent({ settlementService: new StubSettlementService() });
    agent.markReady();
    await expect(agent.execute({ requestId: "req-1", input: {}, audit: { requestId: "req-1", actor: "user-1" } })).rejects.toThrow(/richTicket|ticket \+ officialResult/i);
  });
});
