import { err, generateId, ok, type Result } from "@sport-os/shared";
import { isWithinDeclaredSideEffectLevel, SideEffectLevel, type AgentDeclaration } from "./capabilities.js";
import type { AgentExecutionContext } from "./context.js";
import { agentFailure, AgentFailureCode, toAgentFailure, type AgentFailure } from "./failures.js";
import { FailureDisposition, InvocationStatus, type AgentInvocationRecord, type InvocationsRepository } from "./invocation.js";
import type { IdempotencyStore } from "./idempotency.js";
import { isCommand, validateMessageSchemaVersion, type AgentMessage } from "./messages.js";
import type { Agent, AgentRequest } from "./types.js";

/**
 * Structurally (not nominally) compatible with `GlobalExecutionGate`
 * (`@sport-os/platform`) — agent-core cannot import platform (platform
 * already depends on agent-core; the reverse would be circular), so a
 * real `GlobalExecutionGate` instance is passed in here and satisfies
 * this interface by shape alone, no adapter needed.
 */
export interface ExecutionAuthorizer {
  authorize(context: {
    readonly userId: string;
    readonly agentType: string;
    readonly action: string;
    readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  }): Promise<{ readonly authorized: true } | { readonly authorized: false; readonly failedCheck: string; readonly reason: string; readonly code: string }>;
}

/** Duck-typed against `AuditService` (`@sport-os/platform`) for the same circular-dependency reason as `ExecutionAuthorizer`. */
export interface InvocationAuditSink {
  record(event: {
    readonly actor: string;
    readonly action: string;
    readonly resource: string;
    readonly resourceId: string;
    readonly outcome: "success" | "failure" | "denied";
    readonly requestId: string;
    readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  }): Promise<unknown>;
}

export interface AgentOrchestratorDependencies {
  readonly invocations: InvocationsRepository;
  readonly idempotency: IdempotencyStore;
  /** Required only when a dispatched message's `sideEffectLevel` is REQUESTED_ACTION or EXECUTION (§26: "every execution-capable agent must route through the existing GlobalExecutionGate"). Omitting it is safe for READ_ONLY/ANALYSIS/PROPOSAL agents. */
  readonly executionAuthorizer?: ExecutionAuthorizer | undefined;
  readonly auditSink?: InvocationAuditSink | undefined;
}

export interface DispatchParams<TInput, TOutput> {
  readonly message: AgentMessage<TInput>;
  readonly agent: Agent<TInput, TOutput>;
  readonly declaration: AgentDeclaration;
  readonly context: AgentExecutionContext;
  /** The side-effect level THIS dispatch is about to exercise — checked against `declaration.sideEffectLevel` (§5: "agents must not silently escalate"). */
  readonly sideEffectLevel: SideEffectLevel;
  /** The `action` string passed to `ExecutionAuthorizer.authorize()` when authorization is required — required whenever `sideEffectLevel` is REQUESTED_ACTION or EXECUTION. */
  readonly authorizationAction?: string;
}

export interface DispatchSuccess<TOutput> {
  /** Undefined only when `replayed` is true — an idempotent replay never re-runs the agent, so no fresh TOutput value exists to return; the caller already received the real output the first time this idempotencyKey was dispatched and can find that original invocation via `invocation.invocationId`. */
  readonly output: TOutput | undefined;
  readonly invocation: AgentInvocationRecord;
  readonly replayed: boolean;
}

export interface DispatchFailure {
  readonly failure: AgentFailure;
  readonly invocation: AgentInvocationRecord | undefined;
}

const LEVELS_REQUIRING_AUTHORIZATION: ReadonlySet<SideEffectLevel> = new Set([SideEffectLevel.REQUESTED_ACTION, SideEffectLevel.EXECUTION]);

/**
 * `Agent A -> Typed Agent Message -> Agent Orchestrator -> Policy/
 * Permission Check -> Agent B` (§18). The ONLY sanctioned path a message
 * reaches a target agent's `execute()` — no code in `@sport-os/agents`
 * calls another agent's `execute()` directly.
 *
 * Order of operations, every one of them a documented §-numbered rule:
 *  1. Reject an unknown message schema version (§18) — no invocation
 *     record created; this is a malformed request, not an attempt.
 *  2. Reject an EVENT dispatched where a COMMAND was expected (§19) —
 *     an event must never accidentally trigger execution.
 *  3. Idempotency claim (§20) — a repeat idempotencyKey short-circuits
 *     straight to the ORIGINAL invocation's outcome, never a second run.
 *  4. Side-effect escalation check (§5) — `sideEffectLevel` must be
 *     within the agent's own declared ceiling.
 *  5. Execution authorization (§26) — REQUESTED_ACTION/EXECUTION levels
 *     require `ExecutionAuthorizer.authorize()` to return `authorized:
 *     true` first; no agent reaches `execute()` for these levels
 *     otherwise.
 *  6. Persist IDLE -> RUNNING, call `agent.execute()`, persist the
 *     outcome (COMPLETED, or FAILED with a disposition), audit if a
 *     sink was supplied.
 */
export class AgentOrchestrator {
  constructor(private readonly deps: AgentOrchestratorDependencies) {}

  async dispatch<TInput, TOutput>(params: DispatchParams<TInput, TOutput>): Promise<Result<DispatchSuccess<TOutput>, DispatchFailure>> {
    const { message, agent, declaration, context } = params;

    const schemaCheck = validateMessageSchemaVersion(message);
    if (!schemaCheck.ok) {
      return err({ failure: agentFailure(AgentFailureCode.VALIDATION_ERROR, schemaCheck.reason), invocation: undefined });
    }
    if (!isCommand(message)) {
      return err({ failure: agentFailure(AgentFailureCode.VALIDATION_ERROR, `dispatch() only accepts COMMAND messages; "${message.messageType}" is an EVENT and must never trigger execution.`), invocation: undefined });
    }

    // Idempotency: a repeat key never runs the agent a second time. A
    // terminal prior outcome (success or permanent failure) is replayed
    // as-is; a still-in-flight prior invocation is reported as such so
    // the caller knows not to retry blindly.
    let invocation: AgentInvocationRecord;
    if (message.idempotencyKey !== undefined) {
      const claimed = await this.deps.idempotency.claim(declaration.agentType, message.idempotencyKey, context.invocationId);
      if (claimed.invocationId !== context.invocationId) {
        const priorInvocation = await this.deps.invocations.getById(claimed.invocationId);
        if (priorInvocation) {
          if (priorInvocation.status === InvocationStatus.COMPLETED) {
            return ok({ output: undefined, invocation: priorInvocation, replayed: true });
          }
          if (priorInvocation.status === InvocationStatus.FAILED && priorInvocation.failureDisposition === FailureDisposition.PERMANENT_FAILURE && priorInvocation.failure) {
            return err({ failure: priorInvocation.failure, invocation: priorInvocation });
          }
          return err({
            failure: agentFailure(AgentFailureCode.ALREADY_PROCESSED, `This idempotency key is already associated with an in-flight invocation (status: ${priorInvocation.status}); not starting a duplicate.`, { priorInvocationId: priorInvocation.invocationId, priorStatus: priorInvocation.status }),
            invocation: priorInvocation,
          });
        }
      }
    }

    if (!isWithinDeclaredSideEffectLevel(declaration, params.sideEffectLevel)) {
      const rejectionInvocation = await this.deps.invocations.create({
        invocationId: context.invocationId,
        agentId: declaration.agentId,
        agentType: declaration.agentType,
        agentVersion: declaration.version,
        correlationId: context.correlationId,
        requestedBy: context.actorUserId,
        sideEffectLevel: params.sideEffectLevel,
        inputReference: message.messageId,
        idempotencyKey: message.idempotencyKey,
      });
      const failure = agentFailure(AgentFailureCode.POLICY_REJECTED, `Agent "${declaration.agentId}" declared a ceiling side-effect level of "${declaration.sideEffectLevel}" but this dispatch requested "${params.sideEffectLevel}" — refusing the escalation.`, { declared: declaration.sideEffectLevel, requested: params.sideEffectLevel });
      const failed = await this.deps.invocations.transitionTo(rejectionInvocation.invocationId, InvocationStatus.RUNNING);
      const terminal = await this.deps.invocations.transitionTo(failed.invocationId, InvocationStatus.FAILED, { outputReference: undefined, failure, failureDisposition: FailureDisposition.PERMANENT_FAILURE });
      await this.audit(context, declaration, "denied", { reason: "side_effect_escalation" });
      return err({ failure, invocation: terminal });
    }

    invocation = await this.deps.invocations.create({
      invocationId: context.invocationId,
      agentId: declaration.agentId,
      agentType: declaration.agentType,
      agentVersion: declaration.version,
      correlationId: context.correlationId,
      requestedBy: context.actorUserId,
      sideEffectLevel: params.sideEffectLevel,
      inputReference: message.messageId,
      idempotencyKey: message.idempotencyKey,
    });

    if (LEVELS_REQUIRING_AUTHORIZATION.has(params.sideEffectLevel)) {
      if (!this.deps.executionAuthorizer) {
        return this.failInvocation(invocation, agentFailure(AgentFailureCode.INTEGRATION_UNAVAILABLE, "This dispatch requires execution authorization (REQUESTED_ACTION/EXECUTION) but no ExecutionAuthorizer (GlobalExecutionGate) was configured on this orchestrator.", {}), FailureDisposition.PERMANENT_FAILURE, context, declaration);
      }
      const authorization = await this.deps.executionAuthorizer.authorize({ userId: context.actorUserId, agentType: declaration.agentType, action: params.authorizationAction ?? context.requestedOperation, metadata: { invocationId: context.invocationId } });
      if (!authorization.authorized) {
        // Keyed off `failedCheck` — the gate's own fixed, closed
        // STANDARD_GATE_CHECK_ORDER names ("identity"/"license"/
        // "entitlement"/"risk"/"integration_availability"), not the
        // free-form `code` string a check author chooses (e.g. risk
        // denials use codes like "DAILY_STOP_LOSS_REACHED", which does
        // not itself contain the word "risk").
        const code =
          authorization.failedCheck === "risk"
            ? AgentFailureCode.RISK_REJECTED
            : authorization.failedCheck === "entitlement"
              ? AgentFailureCode.ENTITLEMENT_ERROR
              : authorization.failedCheck === "identity" || authorization.failedCheck === "license"
                ? AgentFailureCode.AUTHORIZATION_ERROR
                : authorization.failedCheck === "integration_availability"
                  ? AgentFailureCode.INTEGRATION_UNAVAILABLE
                  : AgentFailureCode.POLICY_REJECTED;
        const failure = agentFailure(code, `GlobalExecutionGate denied this request at the "${authorization.failedCheck}" check: ${authorization.reason}`, { failedCheck: authorization.failedCheck, gateCode: authorization.code });
        await this.audit(context, declaration, "denied", { failedCheck: authorization.failedCheck, reason: authorization.reason });
        return this.failInvocation(invocation, failure, FailureDisposition.PERMANENT_FAILURE, context, declaration, /* alreadyRunning */ false);
      }
    }

    invocation = await this.deps.invocations.transitionTo(invocation.invocationId, InvocationStatus.RUNNING);

    const request: AgentRequest<TInput> = { requestId: message.messageId, input: message.payload, audit: { requestId: message.messageId, actor: context.actorUserId, correlationId: context.correlationId } };
    try {
      const response = await agent.execute(request);
      invocation = await this.deps.invocations.transitionTo(invocation.invocationId, InvocationStatus.COMPLETED, { outputReference: response.requestId });
      await this.audit(context, declaration, "success", {});
      return ok({ output: response.output, invocation, replayed: false });
    } catch (error) {
      const failure = toAgentFailure(error);
      return this.failInvocation(invocation, failure, failure.retryable ? FailureDisposition.RETRYABLE_FAILURE : FailureDisposition.PERMANENT_FAILURE, context, declaration, /* alreadyRunning */ true);
    }
  }

  private async failInvocation(
    invocation: AgentInvocationRecord,
    failure: AgentFailure,
    disposition: FailureDisposition,
    context: AgentExecutionContext,
    declaration: AgentDeclaration,
    alreadyRunning = false,
  ): Promise<Result<never, DispatchFailure>> {
    const running = alreadyRunning ? invocation : await this.deps.invocations.transitionTo(invocation.invocationId, InvocationStatus.RUNNING);
    const terminal = await this.deps.invocations.transitionTo(running.invocationId, InvocationStatus.FAILED, { outputReference: undefined, failure, failureDisposition: disposition });
    await this.audit(context, declaration, "failure", { code: failure.code, message: failure.message });
    return err({ failure, invocation: terminal });
  }

  private async audit(context: AgentExecutionContext, declaration: AgentDeclaration, outcome: "success" | "failure" | "denied", metadata: Record<string, unknown>): Promise<void> {
    if (!this.deps.auditSink) return;
    await this.deps.auditSink.record({
      actor: context.actorUserId,
      action: context.requestedOperation,
      resource: "agent_invocation",
      resourceId: context.invocationId,
      outcome,
      requestId: generateId(),
      metadata: { agentType: declaration.agentType, agentId: declaration.agentId, correlationId: context.correlationId, ...metadata },
    });
  }
}
