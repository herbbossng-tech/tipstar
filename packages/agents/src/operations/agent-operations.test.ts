import { FailureDisposition, InMemoryInvocationsRepository, InvocationStatus, SideEffectLevel, agentFailure, AgentFailureCode } from "@sport-os/agent-core";
import { Role } from "@sport-os/platform";
import { UserStatus, type AuthorizationContext } from "@sport-os/platform";
import { describe, expect, it } from "vitest";
import { getAgentOperationsSummary } from "./agent-operations.js";

const admin: AuthorizationContext = { userId: "admin-1", role: Role.ADMIN, status: UserStatus.ACTIVE };
const ordinaryUser: AuthorizationContext = { userId: "user-1", role: Role.USER, status: UserStatus.ACTIVE };

async function seedInvocation(repo: InMemoryInvocationsRepository, invocationId: string, agentType: string, outcome: "completed" | "retryable_failure" | "permanent_failure" | "running") {
  const created = await repo.create({ invocationId: invocationId as never, agentId: "agent-1", agentType: agentType as never, agentVersion: "0.1.0", correlationId: "corr-1" as never, requestedBy: "user-1" as never, sideEffectLevel: SideEffectLevel.ANALYSIS, inputReference: "ref", idempotencyKey: undefined });
  await repo.transitionTo(created.invocationId, InvocationStatus.RUNNING);
  if (outcome === "running") return;
  if (outcome === "completed") {
    await repo.transitionTo(created.invocationId, InvocationStatus.COMPLETED, { outputReference: "out" });
    return;
  }
  const disposition = outcome === "retryable_failure" ? FailureDisposition.RETRYABLE_FAILURE : FailureDisposition.PERMANENT_FAILURE;
  await repo.transitionTo(created.invocationId, InvocationStatus.FAILED, { outputReference: undefined, failure: agentFailure(AgentFailureCode.DATA_UNAVAILABLE, "no data"), failureDisposition: disposition });
}

describe("getAgentOperationsSummary — Section 11 §H (read-only, never bypasses AgentOrchestrator)", () => {
  it("TEST 1: a USER is denied the summary entirely", async () => {
    const repo = new InMemoryInvocationsRepository();
    const result = await getAgentOperationsSummary(repo, ordinaryUser, undefined, 50);
    expect(result.ok).toBe(false);
  });

  it("TEST 2: an admin sees real completed/failed/running counts, split by retryable vs permanent disposition", async () => {
    const repo = new InMemoryInvocationsRepository();
    await seedInvocation(repo, "11111111-1111-1111-1111-111111111111", "telegram_channel_management", "completed");
    await seedInvocation(repo, "22222222-2222-2222-2222-222222222222", "telegram_channel_management", "retryable_failure");
    await seedInvocation(repo, "33333333-3333-3333-3333-333333333333", "telegram_channel_management", "permanent_failure");
    await seedInvocation(repo, "44444444-4444-4444-4444-444444444444", "telegram_channel_management", "running");

    const result = await getAgentOperationsSummary(repo, admin, "telegram_channel_management" as never, 50);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalInvocations).toBe(4);
      expect(result.value.completedCount).toBe(1);
      expect(result.value.failedCount).toBe(2);
      expect(result.value.retryableFailureCount).toBe(1);
      expect(result.value.permanentFailureCount).toBe(1);
      expect(result.value.runningCount).toBe(1);
      expect(result.value.recentFailures).toHaveLength(2);
    }
  });

  it("TEST 3: filtering by agentType never leaks another agent type's invocations into the summary", async () => {
    const repo = new InMemoryInvocationsRepository();
    await seedInvocation(repo, "11111111-1111-1111-1111-111111111111", "telegram_channel_management", "completed");
    await seedInvocation(repo, "55555555-5555-5555-5555-555555555555", "settlement", "completed");

    const result = await getAgentOperationsSummary(repo, admin, "telegram_channel_management" as never, 50);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.totalInvocations).toBe(1);
  });

  it("TEST 4: omitting agentType reports across every agent type", async () => {
    const repo = new InMemoryInvocationsRepository();
    await seedInvocation(repo, "11111111-1111-1111-1111-111111111111", "telegram_channel_management", "completed");
    await seedInvocation(repo, "55555555-5555-5555-5555-555555555555", "settlement", "completed");

    const result = await getAgentOperationsSummary(repo, admin, undefined, 50);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.totalInvocations).toBe(2);
  });
});
