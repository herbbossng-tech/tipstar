import { AviatorSignalState, type AviatorSignal } from "@sport-os/aviator-engine";
import { RiskControllerState } from "@sport-os/risk-engine";
import { describe, expect, it } from "vitest";
import type { ExecutionIntegration, ExecutionIntegrationRequest, ExecutionIntegrationResult } from "../execution-integration.js";
import type { AviatorRiskDecision } from "./risk-agent.js";
import { AviatorAutomationAgent, AviatorAutomationOutcome, AviatorExecutionMode } from "./automation-agent.js";

function signal(): AviatorSignal {
  return { signalId: "sig-1", state: AviatorSignalState.BUY, targetMultiplier: 1.5, confidence: 0.7, generatedAt: "2026-01-01T00:00:00Z" };
}

function allowedRisk(): AviatorRiskDecision {
  return { executionAllowed: true, reason: undefined, cumulativePnL: 0, evaluatedAt: "2026-01-01T00:00:00Z" };
}

function blockedRisk(): AviatorRiskDecision {
  return { executionAllowed: false, reason: RiskControllerState.DAILY_STOP_LOSS_REACHED, cumulativePnL: -60, evaluatedAt: "2026-01-01T00:00:00Z" };
}

class RecordingIntegration implements ExecutionIntegration {
  calls: ExecutionIntegrationRequest[] = [];
  available = true;
  async isAvailable(): Promise<boolean> {
    return this.available;
  }
  async execute(request: ExecutionIntegrationRequest): Promise<ExecutionIntegrationResult> {
    this.calls.push(request);
    return { externalReference: "ext-1", stake: request.stake, executedAt: new Date().toISOString() };
  }
}

describe("AviatorAutomationAgent", () => {
  it("refuses to execute when the shared risk controller has blocked execution, regardless of mode — even AUTOMATIC + confirmed (adversarial test #3)", async () => {
    const integration = new RecordingIntegration();
    const agent = new AviatorAutomationAgent({ integration });
    agent.markReady();
    const response = await agent.execute({
      requestId: "req-1",
      input: { signal: signal(), riskDecision: blockedRisk(), executionMode: AviatorExecutionMode.AUTOMATIC, totalStake: 100, target1Multiplier: 1.5, target2Multiplier: 3.0, idempotencyKey: "k1", userConfirmed: true },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    expect(response.output.outcome).toBe(AviatorAutomationOutcome.RISK_BLOCKED);
    expect(integration.calls).toHaveLength(0);
  });

  it("MANUAL mode never calls the integration", async () => {
    const integration = new RecordingIntegration();
    const agent = new AviatorAutomationAgent({ integration });
    agent.markReady();
    const response = await agent.execute({
      requestId: "req-1",
      input: { signal: signal(), riskDecision: allowedRisk(), executionMode: AviatorExecutionMode.MANUAL, totalStake: 100, target1Multiplier: 1.5, target2Multiplier: 3.0, idempotencyKey: "k1", userConfirmed: false },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    expect(response.output.outcome).toBe(AviatorAutomationOutcome.MANUAL_REQUIRED);
    expect(integration.calls).toHaveLength(0);
  });

  it("a permitted, confirmed AUTOMATIC execution places BOTH double-bet legs with a locked 50/50 split", async () => {
    const integration = new RecordingIntegration();
    const agent = new AviatorAutomationAgent({ integration });
    agent.markReady();
    const response = await agent.execute({
      requestId: "req-1",
      input: { signal: signal(), riskDecision: allowedRisk(), executionMode: AviatorExecutionMode.AUTOMATIC, totalStake: 100, target1Multiplier: 1.5, target2Multiplier: 3.0, idempotencyKey: "k1", userConfirmed: true },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    expect(response.output.outcome).toBe(AviatorAutomationOutcome.EXECUTED);
    expect(integration.calls).toHaveLength(2);
    expect(integration.calls[0]?.stake).toBe(50);
    expect(integration.calls[1]?.stake).toBe(50);
    expect(response.output.doubleBet?.target1.stakeWeight).toBe(0.5);
    expect(response.output.doubleBet?.target2.stakeWeight).toBe(0.5);
  });

  it("each leg gets its own distinct idempotency key derived from the request's key — never the same key reused", async () => {
    const integration = new RecordingIntegration();
    const agent = new AviatorAutomationAgent({ integration });
    agent.markReady();
    await agent.execute({
      requestId: "req-1",
      input: { signal: signal(), riskDecision: allowedRisk(), executionMode: AviatorExecutionMode.AUTOMATIC, totalStake: 100, target1Multiplier: 1.5, target2Multiplier: 3.0, idempotencyKey: "round-42", userConfirmed: true },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    expect(integration.calls[0]?.idempotencyKey).not.toBe(integration.calls[1]?.idempotencyKey);
    expect(integration.calls[0]?.idempotencyKey).toContain("round-42");
  });

  it("returns NOT_AVAILABLE, never a fake execution, when no integration is available", async () => {
    const integration = new RecordingIntegration();
    integration.available = false;
    const agent = new AviatorAutomationAgent({ integration });
    agent.markReady();
    const response = await agent.execute({
      requestId: "req-1",
      input: { signal: signal(), riskDecision: allowedRisk(), executionMode: AviatorExecutionMode.AUTOMATIC, totalStake: 100, target1Multiplier: 1.5, target2Multiplier: 3.0, idempotencyKey: "k1", userConfirmed: true },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    expect(response.output.outcome).toBe(AviatorAutomationOutcome.NOT_AVAILABLE);
    expect(response.output.doubleBet).toBeUndefined();
  });
});
