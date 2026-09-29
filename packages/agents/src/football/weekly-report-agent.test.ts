import { SettlementStatus, type Settlement } from "@sport-os/settlement-engine";
import { describe, expect, it } from "vitest";
import { WeeklyReportAgent } from "./weekly-report-agent.js";

function settlement(status: (typeof SettlementStatus)[keyof typeof SettlementStatus], ticketId = "t1"): Settlement {
  return { settlementId: `s-${ticketId}`, ticketId, status, settledAt: "2026-01-10T20:00:00Z" };
}

describe("WeeklyReportAgent", () => {
  it("counts tickets by status correctly", async () => {
    const agent = new WeeklyReportAgent();
    agent.markReady();
    const response = await agent.execute({
      requestId: "req-1",
      input: {
        periodStart: "2026-01-01T00:00:00Z",
        periodEnd: "2026-01-07T23:59:59Z",
        settlements: [settlement(SettlementStatus.WON, "t1"), settlement(SettlementStatus.WON, "t2"), settlement(SettlementStatus.LOST, "t3"), settlement(SettlementStatus.VOID, "t4"), settlement(SettlementStatus.PUSH, "t5"), settlement(SettlementStatus.PENDING, "t6")],
      },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    expect(response.output.ticketCounts).toEqual({ total: 6, won: 2, lost: 1, voided: 1, pushed: 1, pending: 1, cancelled: 0 });
  });

  it("win rate is computed over WON+LOST only, excluding VOID/PUSH/PENDING/CANCELLED from the denominator", async () => {
    const agent = new WeeklyReportAgent();
    agent.markReady();
    const response = await agent.execute({
      requestId: "req-1",
      input: { periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-01-07T23:59:59Z", settlements: [settlement(SettlementStatus.WON, "t1"), settlement(SettlementStatus.LOST, "t2"), settlement(SettlementStatus.VOID, "t3"), settlement(SettlementStatus.PUSH, "t4")] },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    expect(response.output.predictionWinRate).toBe(0.5);
  });

  it("reports win rate as null (never 0) when there are zero settled tickets", async () => {
    const agent = new WeeklyReportAgent();
    agent.markReady();
    const response = await agent.execute({
      requestId: "req-1",
      input: { periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-01-07T23:59:59Z", settlements: [settlement(SettlementStatus.PENDING)] },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    expect(response.output.predictionWinRate).toBeNull();
  });

  it("never reports a fabricated executed-wager P&L — the field is always undefined given this codebase has no real stake/return data (never invents stake or return)", async () => {
    const agent = new WeeklyReportAgent();
    agent.markReady();
    const response = await agent.execute({
      requestId: "req-1",
      input: { periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-01-07T23:59:59Z", settlements: [settlement(SettlementStatus.WON)] },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    expect(response.output.executedWagerPerformance).toBeUndefined();
  });
});
