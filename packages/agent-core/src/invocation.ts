import { ValidationError, type ISODateString, type UUID } from "@sport-os/shared";
import type { SideEffectLevel } from "./capabilities.js";
import type { AgentFailure } from "./failures.js";
import type { AgentType } from "./types.js";

/**
 * Per-invocation workflow state (Section 06 §21) — distinct from
 * `AgentStatus` in types.ts, which tracks an agent INSTANCE's own
 * lifecycle (is this agent enabled/healthy right now), not any one
 * invocation's progress. An agent instance stays READY across thousands
 * of invocations; each of those invocations has its own state here.
 *
 *   IDLE -> RUNNING -> COMPLETED
 *                    -> FAILED (PERMANENT_FAILURE)
 *                    -> FAILED (RETRYABLE_FAILURE) -> RUNNING (retry) -> ...
 *   IDLE|RUNNING -> CANCELLED
 *   RUNNING -> WAITING -> RUNNING   (a human-confirmation boundary, §24)
 */
export const InvocationStatus = {
  IDLE: "idle",
  RUNNING: "running",
  WAITING: "waiting",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;
export type InvocationStatus = (typeof InvocationStatus)[keyof typeof InvocationStatus];

/** Only meaningful when `status === FAILED` — distinguishes "retry this" from "stop." */
export const FailureDisposition = {
  RETRYABLE_FAILURE: "retryable_failure",
  PERMANENT_FAILURE: "permanent_failure",
} as const;
export type FailureDisposition = (typeof FailureDisposition)[keyof typeof FailureDisposition];

const ALLOWED_INVOCATION_TRANSITIONS: Readonly<Record<InvocationStatus, readonly InvocationStatus[]>> = {
  [InvocationStatus.IDLE]: [InvocationStatus.RUNNING, InvocationStatus.CANCELLED],
  [InvocationStatus.RUNNING]: [InvocationStatus.WAITING, InvocationStatus.COMPLETED, InvocationStatus.FAILED, InvocationStatus.CANCELLED],
  [InvocationStatus.WAITING]: [InvocationStatus.RUNNING, InvocationStatus.CANCELLED],
  [InvocationStatus.COMPLETED]: [],
  [InvocationStatus.FAILED]: [InvocationStatus.RUNNING],
  [InvocationStatus.CANCELLED]: [],
};

export function isValidInvocationTransition(from: InvocationStatus, to: InvocationStatus): boolean {
  return ALLOWED_INVOCATION_TRANSITIONS[from].includes(to);
}

/**
 * The durable record of one agent invocation (Section 06 §3/29). This is
 * what "an invocation must have agent_id/agent_type/invocation_id/
 * correlation_id/requested_by/created_at/input reference/output
 * reference/status/failure information" resolves to concretely, and what
 * `InvocationsRepository` persists — see db repositories in
 * `@sport-os/agents` for the Supabase-backed implementation.
 */
export interface AgentInvocationRecord {
  readonly invocationId: UUID;
  readonly agentId: string;
  readonly agentType: AgentType;
  readonly agentVersion: string;
  readonly correlationId: UUID;
  readonly requestedBy: UUID;
  readonly sideEffectLevel: SideEffectLevel;
  readonly status: InvocationStatus;
  readonly failureDisposition: FailureDisposition | undefined;
  readonly failure: AgentFailure | undefined;
  /** An opaque reference (e.g. a request id or storage key), never the raw input/output payload — keeps invocation records small and out of the business-data path. */
  readonly inputReference: string;
  readonly outputReference: string | undefined;
  readonly idempotencyKey: string | undefined;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
  readonly completedAt: ISODateString | undefined;
}

export interface NewAgentInvocationInput {
  readonly invocationId: UUID;
  readonly agentId: string;
  readonly agentType: AgentType;
  readonly agentVersion: string;
  readonly correlationId: UUID;
  readonly requestedBy: UUID;
  readonly sideEffectLevel: SideEffectLevel;
  readonly inputReference: string;
  readonly idempotencyKey: string | undefined;
}

export interface AgentInvocationCompletionInput {
  readonly outputReference: string | undefined;
  readonly failure?: AgentFailure;
  readonly failureDisposition?: FailureDisposition;
}

/** Explicit persistence contract (Section 06 §21: "Prefer explicit persisted workflow state where state must survive process restarts. State transitions must be explicit."). */
export interface InvocationsRepository {
  create(input: NewAgentInvocationInput): Promise<AgentInvocationRecord>;
  getById(invocationId: UUID): Promise<AgentInvocationRecord | undefined>;
  /** Idempotency read path (§20) — a caller checks this BEFORE creating a new invocation for a given key. */
  getByIdempotencyKey(agentType: AgentType, idempotencyKey: string): Promise<AgentInvocationRecord | undefined>;
  transitionTo(invocationId: UUID, status: InvocationStatus, completion?: AgentInvocationCompletionInput): Promise<AgentInvocationRecord>;
  listByCorrelationId(correlationId: UUID): Promise<readonly AgentInvocationRecord[]>;
  /** Section 11 addition — bounded, newest-first listing for the admin "agent operations" view. `agentType` is optional (omit for "every agent type"). */
  listRecentByAgentType(agentType: AgentType | undefined, limit: number): Promise<readonly AgentInvocationRecord[]>;
}

export class InMemoryInvocationsRepository implements InvocationsRepository {
  private readonly byId = new Map<UUID, AgentInvocationRecord>();

  async create(input: NewAgentInvocationInput): Promise<AgentInvocationRecord> {
    const now = new Date().toISOString();
    const record: AgentInvocationRecord = {
      invocationId: input.invocationId,
      agentId: input.agentId,
      agentType: input.agentType,
      agentVersion: input.agentVersion,
      correlationId: input.correlationId,
      requestedBy: input.requestedBy,
      sideEffectLevel: input.sideEffectLevel,
      status: InvocationStatus.IDLE,
      failureDisposition: undefined,
      failure: undefined,
      inputReference: input.inputReference,
      outputReference: undefined,
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
      updatedAt: now,
      completedAt: undefined,
    };
    this.byId.set(record.invocationId, record);
    return record;
  }

  async getById(invocationId: UUID): Promise<AgentInvocationRecord | undefined> {
    return this.byId.get(invocationId);
  }

  async getByIdempotencyKey(agentType: AgentType, idempotencyKey: string): Promise<AgentInvocationRecord | undefined> {
    for (const record of this.byId.values()) {
      if (record.agentType === agentType && record.idempotencyKey === idempotencyKey) return record;
    }
    return undefined;
  }

  async transitionTo(invocationId: UUID, status: InvocationStatus, completion?: AgentInvocationCompletionInput): Promise<AgentInvocationRecord> {
    const existing = this.byId.get(invocationId);
    if (!existing) {
      throw new ValidationError({ message: `No agent invocation found with id "${invocationId}".`, code: "AGENT_INVOCATION_NOT_FOUND", context: { invocationId } });
    }
    if (!isValidInvocationTransition(existing.status, status)) {
      throw new ValidationError({
        message: `Invalid agent invocation transition: ${existing.status} -> ${status}.`,
        code: "AGENT_INVOCATION_INVALID_TRANSITION",
        context: { invocationId, from: existing.status, to: status },
      });
    }
    const now = new Date().toISOString();
    const isTerminal = status === InvocationStatus.COMPLETED || status === InvocationStatus.CANCELLED || (status === InvocationStatus.FAILED && completion?.failureDisposition === FailureDisposition.PERMANENT_FAILURE);
    const updated: AgentInvocationRecord = {
      ...existing,
      status,
      outputReference: completion?.outputReference ?? existing.outputReference,
      failure: completion?.failure ?? (status === InvocationStatus.RUNNING ? undefined : existing.failure),
      failureDisposition: completion?.failureDisposition ?? (status === InvocationStatus.RUNNING ? undefined : existing.failureDisposition),
      updatedAt: now,
      completedAt: isTerminal ? now : existing.completedAt,
    };
    this.byId.set(invocationId, updated);
    return updated;
  }

  async listByCorrelationId(correlationId: UUID): Promise<readonly AgentInvocationRecord[]> {
    return [...this.byId.values()].filter((record) => record.correlationId === correlationId);
  }

  async listRecentByAgentType(agentType: AgentType | undefined, limit: number): Promise<readonly AgentInvocationRecord[]> {
    return [...this.byId.values()]
      .filter((record) => agentType === undefined || record.agentType === agentType)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
}
