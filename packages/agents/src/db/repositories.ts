import type {
  AgentType,
  AgentInvocationCompletionInput,
  AgentInvocationRecord,
  AgentFailureCode,
  AgentMessage,
  FailureDisposition,
  IdempotencyRecord,
  IdempotencyStore,
  InvocationsRepository,
  InvocationStatus,
  NewAgentInvocationInput,
  SideEffectLevel,
} from "@sport-os/agent-core";
import { isValidInvocationTransition } from "@sport-os/agent-core";
import type { SupabaseClient } from "@sport-os/platform";
import { InternalError, ValidationError, type UUID } from "@sport-os/shared";
import type { AgentInvocationRow, AgentMessageRow } from "./types.js";

/**
 * Real, Supabase-backed persistence for the Section 06 agent-operational
 * tables (see supabase/migrations/*agent_invocations.sql /
 * *agent_messages.sql / *agent_idempotency_claims.sql). Always
 * constructed with a service-role client — these tables have no
 * authenticated-role write policy at all (admin-only SELECT, same shape
 * as Section 04/05's operational tables), matching §28's "Authenticated
 * users must not gain arbitrary write access to operational agent
 * state."
 */

function rowToInvocation(row: AgentInvocationRow): AgentInvocationRecord {
  return {
    invocationId: row.id,
    agentId: row.agent_id,
    agentType: row.agent_type as AgentType,
    agentVersion: row.agent_version,
    correlationId: row.correlation_id,
    requestedBy: row.requested_by,
    sideEffectLevel: row.side_effect_level as SideEffectLevel,
    status: row.status as InvocationStatus,
    failureDisposition: (row.failure_disposition as FailureDisposition | null) ?? undefined,
    failure: row.failure_code
      ? { code: row.failure_code as AgentFailureCode, message: row.failure_message ?? "", retryable: row.failure_disposition === "retryable_failure", ...(row.failure_context ? { context: row.failure_context } : {}) }
      : undefined,
    inputReference: row.input_reference,
    outputReference: row.output_reference ?? undefined,
    idempotencyKey: row.idempotency_key ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
  };
}

export class SupabaseInvocationsRepository implements InvocationsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async create(input: NewAgentInvocationInput): Promise<AgentInvocationRecord> {
    const now = new Date().toISOString();
    const { data, error } = await this.client
      .from("agent_invocations")
      .insert({
        id: input.invocationId,
        agent_id: input.agentId,
        agent_type: input.agentType,
        agent_version: input.agentVersion,
        correlation_id: input.correlationId,
        requested_by: input.requestedBy,
        side_effect_level: input.sideEffectLevel,
        status: "idle",
        input_reference: input.inputReference,
        idempotency_key: input.idempotencyKey ?? null,
        created_at: now,
        updated_at: now,
      })
      .select("*")
      .single();
    if (error || !data) {
      throw new InternalError({ message: "Failed to create agent invocation record.", code: "AGENT_INVOCATION_CREATE_FAILED", context: { reason: error?.message } });
    }
    return rowToInvocation(data as AgentInvocationRow);
  }

  async getById(invocationId: UUID): Promise<AgentInvocationRecord | undefined> {
    const { data, error } = await this.client.from("agent_invocations").select("*").eq("id", invocationId).maybeSingle();
    if (error || !data) return undefined;
    return rowToInvocation(data as AgentInvocationRow);
  }

  async getByIdempotencyKey(agentType: AgentType, idempotencyKey: string): Promise<AgentInvocationRecord | undefined> {
    const { data, error } = await this.client.from("agent_invocations").select("*").eq("agent_type", agentType).eq("idempotency_key", idempotencyKey).maybeSingle();
    if (error || !data) return undefined;
    return rowToInvocation(data as AgentInvocationRow);
  }

  async transitionTo(invocationId: UUID, status: InvocationStatus, completion?: AgentInvocationCompletionInput): Promise<AgentInvocationRecord> {
    const existing = await this.getById(invocationId);
    if (!existing) {
      throw new ValidationError({ message: `No agent invocation found with id "${invocationId}".`, code: "AGENT_INVOCATION_NOT_FOUND", context: { invocationId } });
    }
    if (!isValidInvocationTransition(existing.status, status)) {
      throw new ValidationError({ message: `Invalid agent invocation transition: ${existing.status} -> ${status}.`, code: "AGENT_INVOCATION_INVALID_TRANSITION", context: { invocationId, from: existing.status, to: status } });
    }
    const now = new Date().toISOString();
    const isTerminal = status === "completed" || status === "cancelled" || (status === "failed" && completion?.failureDisposition === "permanent_failure");
    const { data, error } = await this.client
      .from("agent_invocations")
      .update({
        status,
        output_reference: completion?.outputReference ?? existing.outputReference ?? null,
        failure_code: completion?.failure?.code ?? (status === "running" ? null : (existing.failure?.code ?? null)),
        failure_message: completion?.failure?.message ?? (status === "running" ? null : (existing.failure?.message ?? null)),
        failure_context: completion?.failure?.context ?? (status === "running" ? null : (existing.failure?.context ?? null)),
        failure_disposition: completion?.failureDisposition ?? (status === "running" ? null : (existing.failureDisposition ?? null)),
        updated_at: now,
        completed_at: isTerminal ? now : (existing.completedAt ?? null),
      })
      .eq("id", invocationId)
      .select("*")
      .single();
    if (error || !data) {
      throw new InternalError({ message: "Failed to update agent invocation record.", code: "AGENT_INVOCATION_UPDATE_FAILED", context: { reason: error?.message } });
    }
    return rowToInvocation(data as AgentInvocationRow);
  }

  async listByCorrelationId(correlationId: UUID): Promise<readonly AgentInvocationRecord[]> {
    const { data, error } = await this.client.from("agent_invocations").select("*").eq("correlation_id", correlationId).order("created_at", { ascending: true });
    if (error || !data) return [];
    return (data as readonly AgentInvocationRow[]).map(rowToInvocation);
  }
}

/**
 * Real, unique-constraint-backed idempotency (`agent_idempotency_claims`
 * has a primary key on `(agent_type, idempotency_key)`) — §20: "Use
 * unique constraints or equivalent backend enforcement... do not rely
 * solely on frontend checks." `claim()` always re-selects after its
 * insert attempt, so the WINNING row (whichever request truly landed
 * first under real concurrency) is always what's returned, exactly
 * mirroring `InMemoryIdempotencyStore`'s contract.
 */
export class SupabaseIdempotencyStore implements IdempotencyStore {
  constructor(private readonly client: SupabaseClient) {}

  async claim(agentType: AgentType, idempotencyKey: string, invocationId: UUID): Promise<IdempotencyRecord> {
    const now = new Date().toISOString();
    await this.client.from("agent_idempotency_claims").upsert({ agent_type: agentType, idempotency_key: idempotencyKey, invocation_id: invocationId, recorded_at: now }, { onConflict: "agent_type,idempotency_key", ignoreDuplicates: true });
    const existing = await this.get(agentType, idempotencyKey);
    if (!existing) {
      throw new InternalError({ message: "Idempotency claim upsert reported success but the row could not be re-read.", code: "AGENT_IDEMPOTENCY_CLAIM_READBACK_FAILED", context: { agentType, idempotencyKey } });
    }
    return existing;
  }

  async get(agentType: AgentType, idempotencyKey: string): Promise<IdempotencyRecord | undefined> {
    const { data, error } = await this.client.from("agent_idempotency_claims").select("*").eq("agent_type", agentType).eq("idempotency_key", idempotencyKey).maybeSingle();
    if (error || !data) return undefined;
    const row = data as { agent_type: string; idempotency_key: string; invocation_id: string; recorded_at: string };
    return { agentType: row.agent_type as AgentType, idempotencyKey: row.idempotency_key, invocationId: row.invocation_id, recordedAt: row.recorded_at };
  }
}

/** Append-only persisted log of every dispatched `AgentMessage` — the durable audit trail for §27/§28's "agent_messages" table, distinct from `agent_invocations` (one message may be replayed/rejected without ever producing an invocation, e.g. a schema-version mismatch). */
export class SupabaseAgentMessagesRepository {
  constructor(private readonly client: SupabaseClient) {}

  async record(message: AgentMessage): Promise<void> {
    const { error } = await this.client.from("agent_messages").insert({
      id: message.messageId,
      correlation_id: message.correlationId,
      kind: message.kind,
      message_type: message.messageType,
      schema_version: message.schemaVersion,
      source_agent: message.sourceAgent,
      target_agent: message.targetAgent,
      payload: message.payload as Record<string, unknown>,
      idempotency_key: message.idempotencyKey ?? null,
      created_at: message.createdAt,
    } satisfies Partial<AgentMessageRow>);
    if (error) {
      throw new InternalError({ message: "Failed to persist agent message.", code: "AGENT_MESSAGE_PERSIST_FAILED", context: { reason: error.message } });
    }
  }

  async listByCorrelationId(correlationId: UUID): Promise<readonly AgentMessageRow[]> {
    const { data, error } = await this.client.from("agent_messages").select("*").eq("correlation_id", correlationId).order("created_at", { ascending: true });
    if (error || !data) return [];
    return data as readonly AgentMessageRow[];
  }
}
