import { SettlementStatus, type MatchResult, type Settlement, type SettlementService, type Ticket } from "@sport-os/settlement-engine";
import { describe, expect, it } from "vitest";
import { SettlementAgent } from "./settlement-agent.js";

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
});
