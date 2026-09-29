import { describe, expect, it } from "vitest";
import { ValidationError } from "@sport-os/shared";
import { AgentStatus } from "./types.js";
import { BaseAgent } from "./base-agent.js";
import type { AgentRequest, AgentResponse } from "./types.js";

class TestAgent extends BaseAgent<{ value: number }, { doubled: number }> {
  moveTo(status: AgentStatus): void {
    this.transitionTo(status);
  }

  async execute(request: AgentRequest<{ value: number }>): Promise<AgentResponse<{ doubled: number }>> {
    return { requestId: request.requestId, output: { doubled: request.input.value * 2 }, completedAt: new Date().toISOString() };
  }
}

function buildAgent(): TestAgent {
  return new TestAgent({ agentId: "agent-1", agentType: "football_intelligence", name: "Test Agent", version: "0.1.0" });
}

describe("BaseAgent lifecycle", () => {
  it("starts DISABLED", () => {
    expect(buildAgent().status).toBe(AgentStatus.DISABLED);
  });

  it("allows the documented happy path: DISABLED -> INITIALIZING -> READY -> RUNNING -> READY", () => {
    const agent = buildAgent();
    agent.moveTo(AgentStatus.INITIALIZING);
    agent.moveTo(AgentStatus.READY);
    agent.moveTo(AgentStatus.RUNNING);
    agent.moveTo(AgentStatus.READY);
    expect(agent.status).toBe(AgentStatus.READY);
  });

  it("allows PAUSED as an intermediate state before resuming or disabling", () => {
    const agent = buildAgent();
    agent.moveTo(AgentStatus.INITIALIZING);
    agent.moveTo(AgentStatus.READY);
    agent.moveTo(AgentStatus.RUNNING);
    agent.moveTo(AgentStatus.PAUSED);
    agent.moveTo(AgentStatus.RUNNING);
    expect(agent.status).toBe(AgentStatus.RUNNING);
  });

  it("allows recovering from ERROR back through INITIALIZING", () => {
    const agent = buildAgent();
    agent.moveTo(AgentStatus.INITIALIZING);
    agent.moveTo(AgentStatus.ERROR);
    agent.moveTo(AgentStatus.INITIALIZING);
    agent.moveTo(AgentStatus.READY);
    expect(agent.status).toBe(AgentStatus.READY);
  });

  it("rejects skipping states, e.g. DISABLED straight to RUNNING", () => {
    const agent = buildAgent();
    expect(() => agent.moveTo(AgentStatus.RUNNING)).toThrow(ValidationError);
    expect(agent.status).toBe(AgentStatus.DISABLED);
  });

  it("rejects an invalid transition and leaves status unchanged", () => {
    const agent = buildAgent();
    agent.moveTo(AgentStatus.INITIALIZING);
    agent.moveTo(AgentStatus.READY);
    expect(() => agent.moveTo(AgentStatus.ERROR)).toThrow(ValidationError);
    expect(agent.status).toBe(AgentStatus.READY);
  });

  it("getHealth() reflects the current status after transitions", () => {
    const agent = buildAgent();
    agent.moveTo(AgentStatus.INITIALIZING);
    expect(agent.getHealth().status).toBe(AgentStatus.INITIALIZING);
  });

  it("execute() carries the requestId through to the response", async () => {
    const agent = buildAgent();
    const response = await agent.execute({ requestId: "req-1", input: { value: 21 }, audit: { requestId: "req-1", actor: "tester" } });
    expect(response.requestId).toBe("req-1");
    expect(response.output.doubled).toBe(42);
  });

  it("markReady() (Section 06 convenience) reaches READY in one call, equivalent to the documented two-step path", () => {
    const agent = buildAgent();
    agent.markReady();
    expect(agent.status).toBe(AgentStatus.READY);
  });
});
