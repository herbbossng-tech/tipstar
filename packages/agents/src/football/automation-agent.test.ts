import type { Ticket } from "@sport-os/settlement-engine";
import { describe, expect, it } from "vitest";
import type { ExecutionIntegration, ExecutionIntegrationRequest, ExecutionIntegrationResult, ExecutionValidationResult } from "../execution-integration.js";
import { ExecutionResultStatus, NotImplementedExecutionIntegration } from "../execution-integration.js";
import { FootballAutomationAgent, FootballAutomationOutcome, FootballExecutionMode } from "./automation-agent.js";

function ticket(): Ticket {
  return { ticketId: "22222222-2222-2222-2222-222222222222", selections: [{ selectionId: "s1", eventId: "fixture-1", market: "match_result_1x2", selection: "HOME", oddsAtPublication: 2.0 }], publishedAt: "2026-01-10T18:00:00Z" };
}

class RecordingIntegration implements ExecutionIntegration {
  calls: ExecutionIntegrationRequest[] = [];
  available = true;
  async isAvailable(): Promise<boolean> {
    return this.available;
  }
  async validate(_request: ExecutionIntegrationRequest): Promise<ExecutionValidationResult> {
    return this.available ? { valid: true } : { valid: false, status: ExecutionResultStatus.NOT_AVAILABLE, reason: "Integration unavailable." };
  }
  async execute(request: ExecutionIntegrationRequest): Promise<ExecutionIntegrationResult> {
    this.calls.push(request);
    return { externalReference: "ext-1", stake: request.stake, executedAt: new Date().toISOString(), status: ExecutionResultStatus.EXECUTED };
  }
  async status(_externalReference: string): Promise<ExecutionResultStatus> {
    return ExecutionResultStatus.EXECUTED;
  }
}

describe("FootballAutomationAgent", () => {
  it("MANUAL mode never calls the integration at all", async () => {
    const integration = new RecordingIntegration();
    const agent = new FootballAutomationAgent({ integration });
    agent.markReady();
    const response = await agent.execute({
      requestId: "req-1",
      input: { ticket: ticket(), executionMode: FootballExecutionMode.MANUAL, stake: 10, idempotencyKey: "k1", userConfirmed: false },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    expect(response.output.outcome).toBe(FootballAutomationOutcome.MANUAL_REQUIRED);
    expect(integration.calls).toHaveLength(0);
  });

  it("ASSISTED mode without confirmation never executes — a generated recommendation is not authorization (§24)", async () => {
    const integration = new RecordingIntegration();
    const agent = new FootballAutomationAgent({ integration });
    agent.markReady();
    const response = await agent.execute({
      requestId: "req-1",
      input: { ticket: ticket(), executionMode: FootballExecutionMode.ASSISTED, stake: 10, idempotencyKey: "k1", userConfirmed: false },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    expect(response.output.outcome).toBe(FootballAutomationOutcome.CONFIRMATION_REQUIRED);
    expect(integration.calls).toHaveLength(0);
  });

  it("ASSISTED mode WITH explicit confirmation executes", async () => {
    const integration = new RecordingIntegration();
    const agent = new FootballAutomationAgent({ integration });
    agent.markReady();
    const response = await agent.execute({
      requestId: "req-1",
      input: { ticket: ticket(), executionMode: FootballExecutionMode.ASSISTED, stake: 10, idempotencyKey: "k1", userConfirmed: true },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    expect(response.output.outcome).toBe(FootballAutomationOutcome.EXECUTED);
    expect(integration.calls).toHaveLength(1);
    expect(response.output.executedWager?.stake).toBe(10);
  });

  it("returns NOT_AVAILABLE (never a fabricated execution) when the integration reports itself unavailable", async () => {
    const integration = new RecordingIntegration();
    integration.available = false;
    const agent = new FootballAutomationAgent({ integration });
    agent.markReady();
    const response = await agent.execute({
      requestId: "req-1",
      input: { ticket: ticket(), executionMode: FootballExecutionMode.AUTOMATIC, stake: 10, idempotencyKey: "k1", userConfirmed: true },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    expect(response.output.outcome).toBe(FootballAutomationOutcome.NOT_AVAILABLE);
    expect(response.output.executedWager).toBeUndefined();
  });

  it("with the real (NotImplemented) integration — which is what this codebase actually ships — automatic mode always returns NOT_AVAILABLE, never a fake execution (adversarial: no unsupported integration invented)", async () => {
    const agent = new FootballAutomationAgent({ integration: new NotImplementedExecutionIntegration() });
    agent.markReady();
    const response = await agent.execute({
      requestId: "req-1",
      input: { ticket: ticket(), executionMode: FootballExecutionMode.AUTOMATIC, stake: 10, idempotencyKey: "k1", userConfirmed: true },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    expect(response.output.outcome).toBe(FootballAutomationOutcome.NOT_AVAILABLE);
  });

  it("rejects a non-positive stake outright", async () => {
    const agent = new FootballAutomationAgent({ integration: new RecordingIntegration() });
    agent.markReady();
    await expect(
      agent.execute({ requestId: "req-1", input: { ticket: ticket(), executionMode: FootballExecutionMode.AUTOMATIC, stake: 0, idempotencyKey: "k1", userConfirmed: true }, audit: { requestId: "req-1", actor: "user-1" } }),
    ).rejects.toThrow(/stake/i);
  });
});
