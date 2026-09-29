import { IntegrationError, ValidationError } from "@sport-os/shared";
import { describe, expect, it } from "vitest";
import { SideEffectLevel, type AgentDeclaration } from "./capabilities.js";
import { buildAgentExecutionContext, type AgentExecutionContext } from "./context.js";
import { AgentFailureCode } from "./failures.js";
import { InMemoryIdempotencyStore } from "./idempotency.js";
import { InMemoryInvocationsRepository, InvocationStatus } from "./invocation.js";
import { CommandType, CURRENT_AGENT_MESSAGE_SCHEMA_VERSION, EventType, MessageKind, type AgentMessage } from "./messages.js";
import { AgentOrchestrator, type ExecutionAuthorizer } from "./orchestrator.js";
import type { Agent, AgentRequest, AgentResponse } from "./types.js";

class StubAgent implements Agent<{ ok: boolean }, { result: string }> {
  readonly agentId = "stub-agent";
  readonly agentType = "football_intelligence" as const;
  readonly name = "Stub Agent";
  readonly version = "0.1.0";
  readonly status = "ready" as const;
  readonly capabilities: readonly string[] = [];
  readonly configuration = {};
  callCount = 0;
  behavior: "succeed" | "throw_validation" | "throw_integration" = "succeed";

  async execute(request: AgentRequest<{ ok: boolean }>): Promise<AgentResponse<{ result: string }>> {
    this.callCount += 1;
    if (this.behavior === "throw_validation") throw new ValidationError({ message: "bad input" });
    if (this.behavior === "throw_integration") throw new IntegrationError({ message: "integration down" });
    return { requestId: request.requestId, output: { result: "ok" }, completedAt: new Date().toISOString() };
  }

  getHealth() {
    return { status: this.status, lastCheckedAt: new Date().toISOString() };
  }
}

function declaration(overrides: Partial<AgentDeclaration> = {}): AgentDeclaration {
  return {
    agentId: "stub-agent",
    agentType: "football_intelligence",
    version: "0.1.0",
    capabilities: ["produce probabilities"],
    requiredEntitlements: [],
    allowedInputs: [CommandType.REQUEST_FOOTBALL_INTELLIGENCE],
    allowedOutputs: [],
    dependencies: [],
    sideEffectLevel: SideEffectLevel.ANALYSIS,
    ...overrides,
  };
}

function context(overrides: Partial<AgentExecutionContext> = {}): AgentExecutionContext {
  return buildAgentExecutionContext({
    invocationId: overrides.invocationId ?? "11111111-1111-1111-1111-111111111111",
    correlationId: overrides.correlationId ?? "22222222-2222-2222-2222-222222222222",
    actorUserId: overrides.actorUserId ?? "33333333-3333-3333-3333-333333333333",
    actorRole: "user",
    environment: "development",
    requestedOperation: "request_football_intelligence",
  });
}

function command(overrides: Partial<AgentMessage<{ ok: boolean }>> = {}): AgentMessage<{ ok: boolean }> {
  return {
    messageId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    correlationId: "22222222-2222-2222-2222-222222222222",
    kind: MessageKind.COMMAND,
    messageType: CommandType.REQUEST_FOOTBALL_INTELLIGENCE,
    schemaVersion: CURRENT_AGENT_MESSAGE_SCHEMA_VERSION,
    sourceAgent: "system",
    targetAgent: "football_intelligence",
    payload: { ok: true },
    createdAt: "2026-01-01T00:00:00Z",
    idempotencyKey: undefined,
    ...overrides,
  };
}

function makeOrchestrator(executionAuthorizer?: ExecutionAuthorizer) {
  const invocations = new InMemoryInvocationsRepository();
  const idempotency = new InMemoryIdempotencyStore();
  const auditEvents: { outcome: string; metadata?: Readonly<Record<string, unknown>> | undefined }[] = [];
  const orchestrator = new AgentOrchestrator({
    invocations,
    idempotency,
    executionAuthorizer,
    auditSink: { record: async (event) => void auditEvents.push({ outcome: event.outcome, metadata: event.metadata }) },
  });
  return { orchestrator, invocations, idempotency, auditEvents };
}

describe("AgentOrchestrator — routing basics", () => {
  it("dispatches a valid COMMAND and returns the agent's real output", async () => {
    const { orchestrator, auditEvents } = makeOrchestrator();
    const agent = new StubAgent();
    const result = await orchestrator.dispatch({ message: command(), agent, declaration: declaration(), context: context(), sideEffectLevel: SideEffectLevel.ANALYSIS });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.output).toEqual({ result: "ok" });
      expect(result.value.invocation.status).toBe(InvocationStatus.COMPLETED);
      expect(result.value.replayed).toBe(false);
    }
    expect(agent.callCount).toBe(1);
    expect(auditEvents.some((e) => e.outcome === "success")).toBe(true);
  });

  it("rejects an unknown message schema version before ever creating an invocation", async () => {
    const { orchestrator, invocations } = makeOrchestrator();
    const agent = new StubAgent();
    const result = await orchestrator.dispatch({ message: command({ schemaVersion: 999 }), agent, declaration: declaration(), context: context(), sideEffectLevel: SideEffectLevel.ANALYSIS });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.failure.code).toBe(AgentFailureCode.VALIDATION_ERROR);
      expect(result.error.invocation).toBeUndefined();
    }
    expect(agent.callCount).toBe(0);
    expect(await invocations.listByCorrelationId("22222222-2222-2222-2222-222222222222")).toHaveLength(0);
  });

  it("refuses to dispatch an EVENT — an event must never trigger execution", async () => {
    const { orchestrator } = makeOrchestrator();
    const agent = new StubAgent();
    const eventMessage = command({ kind: MessageKind.EVENT, messageType: EventType.INTELLIGENCE_GENERATED });
    const result = await orchestrator.dispatch({ message: eventMessage, agent, declaration: declaration(), context: context(), sideEffectLevel: SideEffectLevel.ANALYSIS });
    expect(result.ok).toBe(false);
    expect(agent.callCount).toBe(0);
  });
});

describe("AgentOrchestrator — side-effect escalation", () => {
  it("rejects a dispatch that requests a higher side-effect level than the agent declares, and never calls the agent", async () => {
    const { orchestrator, auditEvents } = makeOrchestrator();
    const agent = new StubAgent();
    const result = await orchestrator.dispatch({ message: command(), agent, declaration: declaration({ sideEffectLevel: SideEffectLevel.ANALYSIS }), context: context(), sideEffectLevel: SideEffectLevel.EXECUTION });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.failure.code).toBe(AgentFailureCode.POLICY_REJECTED);
      expect(result.error.invocation?.status).toBe(InvocationStatus.FAILED);
    }
    expect(agent.callCount).toBe(0);
    expect(auditEvents.some((e) => e.outcome === "denied")).toBe(true);
  });
});

describe("AgentOrchestrator — GlobalExecutionGate integration (§26)", () => {
  it("an EXECUTION-level dispatch with no authorizer configured fails safely without calling the agent", async () => {
    const { orchestrator } = makeOrchestrator(undefined);
    const agent = new StubAgent();
    const result = await orchestrator.dispatch({ message: command(), agent, declaration: declaration({ sideEffectLevel: SideEffectLevel.EXECUTION }), context: context(), sideEffectLevel: SideEffectLevel.EXECUTION });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.failure.code).toBe(AgentFailureCode.INTEGRATION_UNAVAILABLE);
    expect(agent.callCount).toBe(0);
  });

  it("an EXECUTION-level dispatch denied by the gate never reaches the agent (adversarial test #10: impossible to bypass GlobalExecutionGate through supported contracts)", async () => {
    const denyingAuthorizer: ExecutionAuthorizer = { authorize: async () => ({ authorized: false, failedCheck: "risk", reason: "Daily stop-loss reached", code: "DAILY_STOP_LOSS_REACHED" }) };
    const { orchestrator, auditEvents } = makeOrchestrator(denyingAuthorizer);
    const agent = new StubAgent();
    const result = await orchestrator.dispatch({ message: command(), agent, declaration: declaration({ sideEffectLevel: SideEffectLevel.EXECUTION }), context: context(), sideEffectLevel: SideEffectLevel.EXECUTION, authorizationAction: "place_wager" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.failure.code).toBe(AgentFailureCode.RISK_REJECTED);
    expect(agent.callCount).toBe(0);
    expect(auditEvents.some((e) => e.outcome === "denied")).toBe(true);
  });

  it("an EXECUTION-level dispatch approved by the gate reaches the agent", async () => {
    const allowingAuthorizer: ExecutionAuthorizer = { authorize: async () => ({ authorized: true }) };
    const { orchestrator } = makeOrchestrator(allowingAuthorizer);
    const agent = new StubAgent();
    const result = await orchestrator.dispatch({ message: command(), agent, declaration: declaration({ sideEffectLevel: SideEffectLevel.EXECUTION }), context: context(), sideEffectLevel: SideEffectLevel.EXECUTION, authorizationAction: "place_wager" });
    expect(result.ok).toBe(true);
    expect(agent.callCount).toBe(1);
  });
});

describe("AgentOrchestrator — idempotency (§20, adversarial tests #6/#7)", () => {
  it("a duplicate COMMAND with the same idempotencyKey never runs the agent twice", async () => {
    const { orchestrator } = makeOrchestrator();
    const agent = new StubAgent();
    const key = "publish-ticket-42";
    const first = await orchestrator.dispatch({ message: command({ idempotencyKey: key }), agent, declaration: declaration(), context: context(), sideEffectLevel: SideEffectLevel.ANALYSIS });
    expect(first.ok).toBe(true);
    expect(agent.callCount).toBe(1);

    const second = await orchestrator.dispatch({
      message: command({ idempotencyKey: key, messageId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" }),
      agent,
      declaration: declaration(),
      context: context({ invocationId: "44444444-4444-4444-4444-444444444444" }),
      sideEffectLevel: SideEffectLevel.ANALYSIS,
    });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.replayed).toBe(true);
    // The agent was NOT called a second time — this is the whole point of idempotency.
    expect(agent.callCount).toBe(1);
  });
});

describe("AgentOrchestrator — failure typing and disposition", () => {
  it("a ValidationError thrown by the agent becomes a PERMANENT (non-retryable) typed failure", async () => {
    const { orchestrator } = makeOrchestrator();
    const agent = new StubAgent();
    agent.behavior = "throw_validation";
    const result = await orchestrator.dispatch({ message: command(), agent, declaration: declaration(), context: context(), sideEffectLevel: SideEffectLevel.ANALYSIS });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.failure.code).toBe(AgentFailureCode.VALIDATION_ERROR);
      expect(result.error.failure.retryable).toBe(false);
      expect(result.error.invocation?.status).toBe(InvocationStatus.FAILED);
    }
  });

  it("an IntegrationError thrown by the agent becomes a RETRYABLE typed failure", async () => {
    const { orchestrator } = makeOrchestrator();
    const agent = new StubAgent();
    agent.behavior = "throw_integration";
    const result = await orchestrator.dispatch({ message: command(), agent, declaration: declaration(), context: context(), sideEffectLevel: SideEffectLevel.ANALYSIS });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.failure.code).toBe(AgentFailureCode.INTEGRATION_UNAVAILABLE);
      expect(result.error.failure.retryable).toBe(true);
    }
  });
});
