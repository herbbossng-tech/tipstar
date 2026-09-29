import { AviatorSignalState, type AviatorSignal } from "@sport-os/aviator-engine";
import { GlobalDailyRiskController, RiskControllerState } from "@sport-os/risk-engine";
import { describe, expect, it } from "vitest";
import { AviatorRiskAgent } from "./risk-agent.js";

function signal(): AviatorSignal {
  return { signalId: "sig-1", state: AviatorSignalState.BUY, targetMultiplier: 1.5, confidence: 0.7, generatedAt: "2026-01-01T00:00:00Z" };
}

describe("AviatorRiskAgent", () => {
  it("allows execution while the shared risk controller is ACTIVE", async () => {
    const controller = new GlobalDailyRiskController({ dailyTarget: 100, dailyStopLoss: 50 });
    const agent = new AviatorRiskAgent({ riskController: controller });
    agent.markReady();
    const response = await agent.execute({ requestId: "req-1", input: { signal: signal() }, audit: { requestId: "req-1", actor: "user-1" } });
    expect(response.output.executionAllowed).toBe(true);
    expect(response.output.reason).toBeUndefined();
  });

  it("reports DAILY_TARGET_REACHED and disallows execution once the shared controller locks for a win", async () => {
    const controller = new GlobalDailyRiskController({ dailyTarget: 100, dailyStopLoss: 50 });
    controller.recordResult(120);
    const agent = new AviatorRiskAgent({ riskController: controller });
    agent.markReady();
    const response = await agent.execute({ requestId: "req-1", input: { signal: signal() }, audit: { requestId: "req-1", actor: "user-1" } });
    expect(response.output.executionAllowed).toBe(false);
    expect(response.output.reason).toBe(RiskControllerState.DAILY_TARGET_REACHED);
  });

  it("reports DAILY_STOP_LOSS_REACHED and disallows execution once the shared controller locks for a loss", async () => {
    const controller = new GlobalDailyRiskController({ dailyTarget: 100, dailyStopLoss: 50 });
    controller.recordResult(-60);
    const agent = new AviatorRiskAgent({ riskController: controller });
    agent.markReady();
    const response = await agent.execute({ requestId: "req-1", input: { signal: signal() }, audit: { requestId: "req-1", actor: "user-1" } });
    expect(response.output.executionAllowed).toBe(false);
    expect(response.output.reason).toBe(RiskControllerState.DAILY_STOP_LOSS_REACHED);
  });

  it("two agent instances sharing the SAME controller see the same lock state — proof there is only one ledger", async () => {
    const controller = new GlobalDailyRiskController({ dailyTarget: 100, dailyStopLoss: 50 });
    const agentA = new AviatorRiskAgent({ riskController: controller }, "risk-agent-a");
    const agentB = new AviatorRiskAgent({ riskController: controller }, "risk-agent-b");
    agentA.markReady();
    agentB.markReady();
    controller.recordResult(150);
    const responseA = await agentA.execute({ requestId: "req-1", input: { signal: signal() }, audit: { requestId: "req-1", actor: "user-1" } });
    const responseB = await agentB.execute({ requestId: "req-2", input: { signal: signal() }, audit: { requestId: "req-2", actor: "user-1" } });
    expect(responseA.output.executionAllowed).toBe(false);
    expect(responseB.output.executionAllowed).toBe(false);
    expect(responseA.output.cumulativePnL).toBe(responseB.output.cumulativePnL);
  });
});
