import { FailureDisposition, InvocationStatus, type AgentInvocationRecord, type AgentType, type InvocationsRepository } from "@sport-os/agent-core";
import { requireAdmin, type AuthorizationContext } from "@sport-os/platform";
import { err, ok, type AppError, type Result } from "@sport-os/shared";

/**
 * Section 11 Part H — read-only operational visibility over the
 * EXISTING agent framework (`AgentDeclaration`/`AgentInvocationRecord`/
 * `AgentOrchestrator`, Section 06). This module adds NO new agent
 * framework and NEVER bypasses `AgentOrchestrator` — it only composes
 * `InvocationsRepository.listRecentByAgentType()` (the one additive
 * read method Section 11 added to that interface) into an admin-facing
 * summary. An "operational retry" is never performed here either — see
 * `../jobs/worker.ts`'s own retry path for jobs, and
 * `AGENT_CONTRACTS.md` for why re-running an agent invocation directly
 * is never exposed as an admin action (it would mean calling
 * `agent.execute()` outside `AgentOrchestrator.dispatch()`, exactly
 * what §H forbids: "never directly call an execution adapter from an
 * admin UI").
 */

export interface AgentOperationsSummary {
  readonly agentType: AgentType | "all";
  readonly totalInvocations: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly retryableFailureCount: number;
  readonly permanentFailureCount: number;
  readonly runningCount: number;
  readonly recentFailures: readonly AgentInvocationRecord[];
}

const MAX_RECENT_FAILURES = 10;
const MAX_LIST_LIMIT = 200;

export async function getAgentOperationsSummary(invocations: InvocationsRepository, actingUser: AuthorizationContext, agentType: AgentType | undefined, limit: number): Promise<Result<AgentOperationsSummary, AppError>> {
  const denied = requireAdmin(actingUser);
  if (denied) return err(denied);

  const boundedLimit = Math.max(1, Math.min(limit, MAX_LIST_LIMIT));
  const records = await invocations.listRecentByAgentType(agentType, boundedLimit);

  const completedCount = records.filter((r) => r.status === InvocationStatus.COMPLETED).length;
  const failedRecords = records.filter((r) => r.status === InvocationStatus.FAILED);
  const retryableFailureCount = failedRecords.filter((r) => r.failureDisposition === FailureDisposition.RETRYABLE_FAILURE).length;
  const permanentFailureCount = failedRecords.filter((r) => r.failureDisposition === FailureDisposition.PERMANENT_FAILURE).length;
  const runningCount = records.filter((r) => r.status === InvocationStatus.RUNNING).length;

  return ok({
    agentType: agentType ?? "all",
    totalInvocations: records.length,
    completedCount,
    failedCount: failedRecords.length,
    retryableFailureCount,
    permanentFailureCount,
    runningCount,
    recentFailures: failedRecords.slice(0, MAX_RECENT_FAILURES),
  });
}
