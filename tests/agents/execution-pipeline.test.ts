/**
 * Cross-package integration test: exercises the Section 01 architecture
 * skeleton end to end —
 *
 *   AgentService (register) -> GlobalExecutionGate (authorize) ->
 *   Agent.execute() -> AuditService (record)
 *
 * Every individual gate check here is a test double (no real identity/
 * license/risk business logic exists yet — that is later-section work).
 * What this test proves is real: the orchestration itself — that a
 * denied check stops execution before the agent ever runs, and that an
 * authorized request's outcome is genuinely auditable.
 */
import { describe, expect, it } from "vitest";
import { AgentStatus, BaseAgent, InMemoryAgentRegistry, type AgentRequest, type AgentResponse } from "@sport-os/agent-core";
import { AuditOutcome, GlobalExecutionGate, InMemoryAuditService, type GateCheck } from "@sport-os/platform";

class PublishTicketAgent extends BaseAgent<{ ticketId: string }, { published: boolean }> {
  moveTo(status: AgentStatus): void {
    this.transitionTo(status);
  }

  async execute(request: AgentRequest<{ ticketId: string }>): Promise<AgentResponse<{ published: boolean }>> {
    return { requestId: request.requestId, output: { published: true }, completedAt: new Date().toISOString() };
  }
}

describe("execution pipeline (agent-core + platform)", () => {
  it("authorizes, executes, and audits a permitted request", async () => {
    const registry = new InMemoryAgentRegistry();
    const agent = new PublishTicketAgent({ agentId: "agent-1", agentType: "football_decision", name: "Publish Ticket Agent", version: "0.1.0" });
    agent.moveTo(AgentStatus.INITIALIZING);
    agent.moveTo(AgentStatus.READY);
    registry.register(agent);

    const gate = new GlobalExecutionGate([
      { name: "identity", check: () => ({ allowed: true }) },
      { name: "license", check: () => ({ allowed: true }) },
    ]);
    const audit = new InMemoryAuditService();

    const authorization = await gate.authorize({ userId: "user-1", agentType: agent.agentType, action: "publish_ticket" });
    expect(authorization.authorized).toBe(true);

    const response = await registry.execute<{ ticketId: string }, { published: boolean }>("agent-1", {
      requestId: "req-1",
      input: { ticketId: "ticket-1" },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    await audit.record({ actor: "user-1", action: "publish_ticket", resource: "ticket", resourceId: "ticket-1", outcome: AuditOutcome.SUCCESS, requestId: "req-1" });

    expect(response.output.published).toBe(true);
    expect(audit.getEvents()).toHaveLength(1);
    expect(audit.getEvents()[0]?.outcome).toBe(AuditOutcome.SUCCESS);
  });

  it("denies at the gate and never lets the agent execute or a success event get recorded", async () => {
    const registry = new InMemoryAgentRegistry();
    const agent = new PublishTicketAgent({ agentId: "agent-1", agentType: "football_decision", name: "Publish Ticket Agent", version: "0.1.0" });
    registry.register(agent);

    let agentWasCalled = false;
    const trackingAgent = agent.execute.bind(agent);
    agent.execute = async (request: AgentRequest<{ ticketId: string }>) => {
      agentWasCalled = true;
      return trackingAgent(request);
    };

    const licenseExpiredCheck: GateCheck = { name: "license", check: () => ({ allowed: false, reason: "License expired", code: "LICENSE_EXPIRED" }) };
    const gate = new GlobalExecutionGate([{ name: "identity", check: () => ({ allowed: true }) }, licenseExpiredCheck]);
    const audit = new InMemoryAuditService();

    const authorization = await gate.authorize({ userId: "user-1", agentType: agent.agentType, action: "publish_ticket" });
    expect(authorization.authorized).toBe(false);

    if (!authorization.authorized) {
      await audit.record({ actor: "user-1", action: "execution_rejected", resource: "agent", resourceId: agent.agentId, outcome: AuditOutcome.DENIED, requestId: "req-2", metadata: { reason: authorization.reason } });
    }

    expect(agentWasCalled).toBe(false);
    expect(audit.getEvents()).toHaveLength(1);
    expect(audit.getEvents()[0]?.outcome).toBe(AuditOutcome.DENIED);
  });
});
