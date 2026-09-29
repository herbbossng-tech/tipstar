import { describe, expect, it } from "vitest";
import { agentFailure, AgentFailureCode } from "./failures.js";
import { FailureDisposition, InMemoryInvocationsRepository, InvocationStatus, isValidInvocationTransition } from "./invocation.js";

describe("invocation.ts — per-invocation state machine", () => {
  it("permits IDLE -> RUNNING -> COMPLETED", () => {
    expect(isValidInvocationTransition(InvocationStatus.IDLE, InvocationStatus.RUNNING)).toBe(true);
    expect(isValidInvocationTransition(InvocationStatus.RUNNING, InvocationStatus.COMPLETED)).toBe(true);
  });

  it("permits a RETRYABLE_FAILURE to move back to RUNNING (a retry)", () => {
    expect(isValidInvocationTransition(InvocationStatus.FAILED, InvocationStatus.RUNNING)).toBe(true);
  });

  it("permits WAITING for a human-confirmation boundary, and a return to RUNNING once confirmed", () => {
    expect(isValidInvocationTransition(InvocationStatus.RUNNING, InvocationStatus.WAITING)).toBe(true);
    expect(isValidInvocationTransition(InvocationStatus.WAITING, InvocationStatus.RUNNING)).toBe(true);
  });

  it("rejects a transition out of a terminal COMPLETED state", () => {
    expect(isValidInvocationTransition(InvocationStatus.COMPLETED, InvocationStatus.RUNNING)).toBe(false);
    expect(isValidInvocationTransition(InvocationStatus.COMPLETED, InvocationStatus.FAILED)).toBe(false);
  });

  it("rejects skipping straight from IDLE to COMPLETED", () => {
    expect(isValidInvocationTransition(InvocationStatus.IDLE, InvocationStatus.COMPLETED)).toBe(false);
  });
});

describe("InMemoryInvocationsRepository", () => {
  it("creates a record in IDLE and transitions it through to COMPLETED", async () => {
    const repo = new InMemoryInvocationsRepository();
    const created = await repo.create({
      invocationId: "11111111-1111-1111-1111-111111111111",
      agentId: "agent-1",
      agentType: "football_intelligence",
      agentVersion: "0.1.0",
      correlationId: "22222222-2222-2222-2222-222222222222",
      requestedBy: "33333333-3333-3333-3333-333333333333",
      sideEffectLevel: "analysis",
      inputReference: "req-1",
      idempotencyKey: undefined,
    });
    expect(created.status).toBe(InvocationStatus.IDLE);

    const running = await repo.transitionTo(created.invocationId, InvocationStatus.RUNNING);
    expect(running.status).toBe(InvocationStatus.RUNNING);
    expect(running.completedAt).toBeUndefined();

    const completed = await repo.transitionTo(created.invocationId, InvocationStatus.COMPLETED, { outputReference: "out-1" });
    expect(completed.status).toBe(InvocationStatus.COMPLETED);
    expect(completed.outputReference).toBe("out-1");
    expect(completed.completedAt).toBeDefined();
  });

  it("throws on an invalid transition rather than silently applying it", async () => {
    const repo = new InMemoryInvocationsRepository();
    const created = await repo.create({
      invocationId: "11111111-1111-1111-1111-111111111111",
      agentId: "agent-1",
      agentType: "football_intelligence",
      agentVersion: "0.1.0",
      correlationId: "22222222-2222-2222-2222-222222222222",
      requestedBy: "33333333-3333-3333-3333-333333333333",
      sideEffectLevel: "analysis",
      inputReference: "req-1",
      idempotencyKey: undefined,
    });
    await expect(repo.transitionTo(created.invocationId, InvocationStatus.COMPLETED)).rejects.toThrow(/invalid agent invocation transition/i);
  });

  it("records a permanent failure with its typed AgentFailure attached", async () => {
    const repo = new InMemoryInvocationsRepository();
    const created = await repo.create({
      invocationId: "11111111-1111-1111-1111-111111111111",
      agentId: "agent-1",
      agentType: "football_intelligence",
      agentVersion: "0.1.0",
      correlationId: "22222222-2222-2222-2222-222222222222",
      requestedBy: "33333333-3333-3333-3333-333333333333",
      sideEffectLevel: "analysis",
      inputReference: "req-1",
      idempotencyKey: undefined,
    });
    await repo.transitionTo(created.invocationId, InvocationStatus.RUNNING);
    const failure = agentFailure(AgentFailureCode.MODEL_ERROR, "the ensemble produced an invalid distribution");
    const failed = await repo.transitionTo(created.invocationId, InvocationStatus.FAILED, { outputReference: undefined, failure, failureDisposition: FailureDisposition.PERMANENT_FAILURE });
    expect(failed.status).toBe(InvocationStatus.FAILED);
    expect(failed.failure?.code).toBe(AgentFailureCode.MODEL_ERROR);
    expect(failed.failureDisposition).toBe(FailureDisposition.PERMANENT_FAILURE);
  });

  it("finds a record by (agentType, idempotencyKey)", async () => {
    const repo = new InMemoryInvocationsRepository();
    const created = await repo.create({
      invocationId: "11111111-1111-1111-1111-111111111111",
      agentId: "agent-1",
      agentType: "telegram_channel_management",
      agentVersion: "0.1.0",
      correlationId: "22222222-2222-2222-2222-222222222222",
      requestedBy: "33333333-3333-3333-3333-333333333333",
      sideEffectLevel: "requested_action",
      inputReference: "req-1",
      idempotencyKey: "publish-ticket-42",
    });
    const found = await repo.getByIdempotencyKey("telegram_channel_management", "publish-ticket-42");
    expect(found?.invocationId).toBe(created.invocationId);
    expect(await repo.getByIdempotencyKey("telegram_channel_management", "some-other-key")).toBeUndefined();
    // A different agent type using the identical key string is a distinct claim.
    expect(await repo.getByIdempotencyKey("football_automation", "publish-ticket-42")).toBeUndefined();
  });

  it("lists every invocation sharing a correlationId", async () => {
    const repo = new InMemoryInvocationsRepository();
    const correlationId = "22222222-2222-2222-2222-222222222222";
    await repo.create({ invocationId: "11111111-1111-1111-1111-111111111111", agentId: "a1", agentType: "football_intelligence", agentVersion: "0.1.0", correlationId, requestedBy: "u1", sideEffectLevel: "analysis", inputReference: "r1", idempotencyKey: undefined });
    await repo.create({ invocationId: "44444444-4444-4444-4444-444444444444", agentId: "a2", agentType: "football_decision", agentVersion: "0.1.0", correlationId, requestedBy: "u1", sideEffectLevel: "proposal", inputReference: "r2", idempotencyKey: undefined });
    const related = await repo.listByCorrelationId(correlationId);
    expect(related).toHaveLength(2);
  });
});
