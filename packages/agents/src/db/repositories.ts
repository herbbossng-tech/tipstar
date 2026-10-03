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
import { isValidJobTransition, type JobFailureCategory, type JobStatus, type NewOperationalJobInput, type OperationalJobCompletionInput, type OperationalJobRecord, type OperationalJobsRepository, type OperationalJobType, type SupabaseClient } from "@sport-os/platform";
import { InternalError, ValidationError, type UUID } from "@sport-os/shared";
import type { PerformanceLedgerEntry } from "@sport-os/settlement-engine";
import type {
  NewTelegramPublicationInput,
  PublicationSourceType,
  PublishableContentType,
  TelegramDestination,
  TelegramDestinationManager,
  TelegramDestinationVerificationStatus,
  TelegramPublicationCompletionInput,
  TelegramPublicationRecord,
  TelegramPublicationsRepository,
} from "@sport-os/telegram";
import type { AgentInvocationRow, AgentMessageRow, OperationalJobRow, PerformanceLedgerRow, TelegramDestinationRow, TelegramPublicationRow, WeeklyReportRow } from "./types.js";

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

  async listRecentByAgentType(agentType: AgentType | undefined, limit: number): Promise<readonly AgentInvocationRecord[]> {
    let query = this.client.from("agent_invocations").select("*").order("created_at", { ascending: false }).limit(limit);
    if (agentType) query = query.eq("agent_type", agentType);
    const { data, error } = await query;
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

/**
 * Real, Supabase-backed `TelegramDestinationManager` (Section 10 §8).
 * Lives here, not in `@sport-os/telegram`, because `@sport-os/platform`
 * already depends on `@sport-os/telegram` — `@sport-os/telegram`
 * depending back on Supabase/platform would be circular. Pure
 * persistence only: the OWNER/ADMIN authorization check, the Bot-API
 * verification call, and the audit write all happen one layer up (see
 * `destination-manager.ts`), exactly like
 * `packages/platform/src/user-admin.ts` keeps `UsersRepository` a pure
 * persistence boundary beneath its own authorization-checking functions.
 */
function rowToDestination(row: TelegramDestinationRow): TelegramDestination {
  return {
    destinationId: row.destination_id as UUID,
    telegramChatId: row.telegram_chat_id,
    name: row.name,
    type: row.type as TelegramDestination["type"],
    enabled: row.enabled,
    autoPublish: row.auto_publish,
    publishBookingCode: row.publish_booking_code,
    publishTicket: row.publish_ticket,
    publishResults: row.publish_results,
    publishWeeklyReport: row.publish_weekly_report,
    createdAt: row.created_at,
    verificationStatus: row.verification_status as TelegramDestinationVerificationStatus,
    verifiedAt: row.verified_at ?? undefined,
    createdBy: row.created_by,
  };
}

export class SupabaseTelegramDestinationManager implements TelegramDestinationManager {
  constructor(private readonly client: SupabaseClient) {}

  async list(): Promise<readonly TelegramDestination[]> {
    const { data, error } = await this.client.from("telegram_destinations").select("*").order("created_at", { ascending: true });
    if (error || !data) return [];
    return (data as readonly TelegramDestinationRow[]).map(rowToDestination);
  }

  async get(destinationId: string): Promise<TelegramDestination | undefined> {
    const { data, error } = await this.client.from("telegram_destinations").select("*").eq("destination_id", destinationId).maybeSingle();
    if (error || !data) return undefined;
    return rowToDestination(data as TelegramDestinationRow);
  }

  async create(destination: Omit<TelegramDestination, "destinationId" | "createdAt">, createdBy: string): Promise<TelegramDestination> {
    const { data, error } = await this.client
      .from("telegram_destinations")
      .insert({
        telegram_chat_id: destination.telegramChatId,
        name: destination.name,
        type: destination.type,
        enabled: destination.enabled,
        auto_publish: destination.autoPublish,
        publish_booking_code: destination.publishBookingCode,
        publish_ticket: destination.publishTicket,
        publish_results: destination.publishResults,
        publish_weekly_report: destination.publishWeeklyReport,
        verification_status: destination.verificationStatus ?? "unverified",
        verified_at: destination.verifiedAt ?? null,
        created_by: createdBy,
      })
      .select("*")
      .single();
    if (error || !data) {
      throw new InternalError({ message: "Failed to create Telegram destination.", code: "TELEGRAM_DESTINATION_CREATE_FAILED", context: { reason: error?.message } });
    }
    return rowToDestination(data as TelegramDestinationRow);
  }

  async update(destinationId: string, patch: Partial<Omit<TelegramDestination, "destinationId" | "createdAt">>): Promise<TelegramDestination> {
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.telegramChatId !== undefined) update.telegram_chat_id = patch.telegramChatId;
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.type !== undefined) update.type = patch.type;
    if (patch.enabled !== undefined) update.enabled = patch.enabled;
    if (patch.autoPublish !== undefined) update.auto_publish = patch.autoPublish;
    if (patch.publishBookingCode !== undefined) update.publish_booking_code = patch.publishBookingCode;
    if (patch.publishTicket !== undefined) update.publish_ticket = patch.publishTicket;
    if (patch.publishResults !== undefined) update.publish_results = patch.publishResults;
    if (patch.publishWeeklyReport !== undefined) update.publish_weekly_report = patch.publishWeeklyReport;
    if (patch.verificationStatus !== undefined) update.verification_status = patch.verificationStatus;
    if (patch.verifiedAt !== undefined) update.verified_at = patch.verifiedAt ?? null;

    const { data, error } = await this.client.from("telegram_destinations").update(update).eq("destination_id", destinationId).select("*").single();
    if (error || !data) {
      throw new InternalError({ message: "Failed to update Telegram destination.", code: "TELEGRAM_DESTINATION_UPDATE_FAILED", context: { reason: error?.message } });
    }
    return rowToDestination(data as TelegramDestinationRow);
  }
}

/**
 * Real, Supabase-backed `TelegramPublicationsRepository` (Section 10
 * §21/§30/§49). `findOrCreate()` is the database-enforced idempotency
 * boundary — it upserts against `telegram_publications_natural_key_idx`
 * (the unique index on source_type/source_id/source_version/
 * publication_type/destination_id) with `ignoreDuplicates: true`, then
 * always re-selects by that same tuple, so concurrent callers for the
 * same tuple converge on the one row that actually won the insert —
 * exactly the same pattern `SupabaseIdempotencyStore.claim()` uses above.
 */
function rowToPublication(row: TelegramPublicationRow): TelegramPublicationRecord {
  return {
    id: row.id as UUID,
    sourceType: row.source_type as PublicationSourceType,
    sourceId: row.source_id,
    sourceVersion: row.source_version,
    publicationType: row.publication_type as PublishableContentType,
    destinationId: row.destination_id as UUID,
    status: row.status as TelegramPublicationRecord["status"],
    telegramMessageId: row.telegram_message_id ?? undefined,
    replyToTelegramMessageId: row.reply_to_telegram_message_id ?? undefined,
    templateVersion: row.template_version,
    policyVersion: row.policy_version,
    requestedBy: row.requested_by,
    idempotencyKey: row.idempotency_key,
    correlationId: row.correlation_id as UUID,
    attemptCount: row.attempt_count,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SupabaseTelegramPublicationsRepository implements TelegramPublicationsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async findOrCreate(input: NewTelegramPublicationInput): Promise<TelegramPublicationRecord> {
    const now = new Date().toISOString();
    await this.client
      .from("telegram_publications")
      .upsert(
        {
          source_type: input.sourceType,
          source_id: input.sourceId,
          source_version: input.sourceVersion,
          publication_type: input.publicationType,
          destination_id: input.destinationId,
          status: "PENDING",
          reply_to_telegram_message_id: input.replyToTelegramMessageId ?? null,
          template_version: input.templateVersion,
          policy_version: input.policyVersion,
          requested_by: input.requestedBy,
          idempotency_key: input.idempotencyKey,
          correlation_id: input.correlationId,
          attempt_count: 0,
          created_at: now,
          updated_at: now,
        },
        { onConflict: "source_type,source_id,source_version,publication_type,destination_id", ignoreDuplicates: true },
      );

    const { data, error } = await this.client
      .from("telegram_publications")
      .select("*")
      .eq("source_type", input.sourceType)
      .eq("source_id", input.sourceId)
      .eq("source_version", input.sourceVersion)
      .eq("publication_type", input.publicationType)
      .eq("destination_id", input.destinationId)
      .maybeSingle();
    if (error || !data) {
      throw new InternalError({ message: "Failed to create or read back Telegram publication record.", code: "TELEGRAM_PUBLICATION_FINDORCREATE_FAILED", context: { reason: error?.message } });
    }
    return rowToPublication(data as TelegramPublicationRow);
  }

  async transitionTo(id: UUID, completion: TelegramPublicationCompletionInput): Promise<TelegramPublicationRecord> {
    const { data: existing, error: readError } = await this.client.from("telegram_publications").select("*").eq("id", id).maybeSingle();
    if (readError || !existing) {
      throw new ValidationError({ message: `No Telegram publication found with id "${id}".`, code: "TELEGRAM_PUBLICATION_NOT_FOUND", context: { id } });
    }
    const row = existing as TelegramPublicationRow;
    const { data, error } = await this.client
      .from("telegram_publications")
      .update({
        status: completion.status,
        telegram_message_id: completion.telegramMessageId ?? row.telegram_message_id,
        last_error: completion.lastError ?? null,
        attempt_count: row.attempt_count + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error || !data) {
      throw new InternalError({ message: "Failed to update Telegram publication record.", code: "TELEGRAM_PUBLICATION_UPDATE_FAILED", context: { reason: error?.message } });
    }
    return rowToPublication(data as TelegramPublicationRow);
  }

  async findOriginalMessageForReply(params: { readonly sourceType: PublicationSourceType; readonly sourceId: string; readonly destinationId: UUID }): Promise<TelegramPublicationRecord | undefined> {
    const { data, error } = await this.client
      .from("telegram_publications")
      .select("*")
      .eq("source_type", params.sourceType)
      .eq("source_id", params.sourceId)
      .eq("destination_id", params.destinationId)
      .in("publication_type", ["ticket", "pick"])
      .eq("status", "PUBLISHED")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return undefined;
    return rowToPublication(data as TelegramPublicationRow);
  }

  async countPublishedSince(destinationId: UUID, publicationType: PublishableContentType, since: string): Promise<number> {
    const { count, error } = await this.client
      .from("telegram_publications")
      .select("id", { count: "exact", head: true })
      .eq("destination_id", destinationId)
      .eq("publication_type", publicationType)
      .eq("status", "PUBLISHED")
      .gte("created_at", since);
    if (error) {
      throw new InternalError({ message: "Failed to count Telegram publications.", code: "TELEGRAM_PUBLICATION_COUNT_FAILED", context: { reason: error.message } });
    }
    return count ?? 0;
  }
}

/**
 * Real, Supabase-backed `OperationalJobsRepository` (Section 11 §E/
 * §AD). `claimNext()` calls `claim_next_operational_job()` — the one
 * atomic claim function (`supabase/migrations/*operational_jobs.sql`),
 * never a client-side SELECT-then-UPDATE (that would race under
 * concurrent workers exactly the way `claim_owner_bootstrap()`'s own
 * doc comment explains).
 */
function rowToJob(row: OperationalJobRow): OperationalJobRecord {
  return {
    jobId: row.job_id as UUID,
    jobType: row.job_type as OperationalJobType,
    status: row.status as JobStatus,
    payloadReference: row.payload_reference,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    nextAttemptAt: row.next_attempt_at ?? undefined,
    lastError: row.last_error ?? undefined,
    lastFailureCategory: (row.last_failure_category as JobFailureCategory | null) ?? undefined,
    idempotencyKey: row.idempotency_key,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SupabaseOperationalJobsRepository implements OperationalJobsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async create(input: NewOperationalJobInput): Promise<OperationalJobRecord> {
    const now = new Date().toISOString();
    const { data, error } = await this.client
      .from("operational_jobs")
      .insert({
        job_type: input.jobType,
        status: "QUEUED",
        payload_reference: input.payloadReference,
        scheduled_at: input.scheduledAt,
        max_attempts: input.maxAttempts,
        idempotency_key: input.idempotencyKey,
        created_by: input.createdBy,
        created_at: now,
        updated_at: now,
      })
      .select("*")
      .single();
    if (error || !data) {
      throw new InternalError({ message: "Failed to create operational job.", code: "OPERATIONAL_JOB_CREATE_FAILED", context: { reason: error?.message } });
    }
    return rowToJob(data as OperationalJobRow);
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<OperationalJobRecord | undefined> {
    const { data, error } = await this.client.from("operational_jobs").select("*").eq("idempotency_key", idempotencyKey).maybeSingle();
    if (error || !data) return undefined;
    return rowToJob(data as OperationalJobRow);
  }

  async claimNext(jobType: OperationalJobType | undefined, now: string, leaseTimeoutMs: number): Promise<OperationalJobRecord | undefined> {
    if (!jobType) return undefined;
    const { data, error } = await this.client.rpc("claim_next_operational_job", { p_job_type: jobType, p_now: now, p_lease_timeout_ms: leaseTimeoutMs });
    if (error || !data) return undefined;
    return rowToJob(data as OperationalJobRow);
  }

  async transitionTo(jobId: UUID, completion: OperationalJobCompletionInput): Promise<OperationalJobRecord> {
    const { data: existing, error: readError } = await this.client.from("operational_jobs").select("*").eq("job_id", jobId).maybeSingle();
    if (readError || !existing) {
      throw new ValidationError({ message: `No operational job found with id "${jobId}".`, code: "OPERATIONAL_JOB_NOT_FOUND", context: { jobId } });
    }
    const existingJob = rowToJob(existing as OperationalJobRow);
    if (!isValidJobTransition(existingJob.status, completion.status)) {
      throw new ValidationError({ message: `Invalid operational job transition: ${existingJob.status} -> ${completion.status}.`, code: "OPERATIONAL_JOB_INVALID_TRANSITION", context: { jobId, from: existingJob.status, to: completion.status } });
    }
    const now = new Date().toISOString();
    const isTerminal = completion.status === "SUCCEEDED" || completion.status === "CANCELLED";
    const { data, error } = await this.client
      .from("operational_jobs")
      .update({
        status: completion.status,
        last_error: completion.lastError ?? null,
        last_failure_category: completion.lastFailureCategory ?? null,
        next_attempt_at: completion.nextAttemptAt ?? null,
        completed_at: isTerminal ? now : null,
        updated_at: now,
      })
      .eq("job_id", jobId)
      .select("*")
      .single();
    if (error || !data) {
      throw new InternalError({ message: "Failed to update operational job.", code: "OPERATIONAL_JOB_UPDATE_FAILED", context: { reason: error?.message } });
    }
    return rowToJob(data as OperationalJobRow);
  }

  async listRecent(params: { readonly jobType?: OperationalJobType; readonly status?: JobStatus; readonly limit: number }): Promise<readonly OperationalJobRecord[]> {
    let query = this.client.from("operational_jobs").select("*").order("created_at", { ascending: false }).limit(params.limit);
    if (params.jobType) query = query.eq("job_type", params.jobType);
    if (params.status) query = query.eq("status", params.status);
    const { data, error } = await query;
    if (error || !data) return [];
    return (data as readonly OperationalJobRow[]).map(rowToJob);
  }
}

/**
 * Real, Supabase-backed repository for `weekly_reports` (Section 11
 * §J-§O). `create()` is the ONLY write method — this table is
 * insert-only; there is deliberately no `update()` method here at all,
 * so immutability is enforced by the TypeScript interface itself, not
 * merely by convention.
 */
export interface WeeklyReportRecord {
  readonly reportId: UUID;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly ledgerMode: string;
  readonly reportVersion: number;
  readonly status: string;
  readonly generatedAt: string;
  readonly generatedBy: string;
  readonly sourceReference: Record<string, unknown>;
  readonly reportPayload: Record<string, unknown>;
  readonly supersedesReportId: UUID | undefined;
  readonly supersededReason: string | undefined;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

export interface NewWeeklyReportInput {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly ledgerMode: string;
  readonly reportVersion: number;
  readonly generatedBy: string;
  readonly sourceReference: Record<string, unknown>;
  readonly reportPayload: Record<string, unknown>;
  readonly supersedesReportId?: UUID;
  readonly supersededReason?: string;
  readonly idempotencyKey: string;
}

function rowToWeeklyReport(row: WeeklyReportRow): WeeklyReportRecord {
  return {
    reportId: row.report_id as UUID,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    ledgerMode: row.ledger_mode,
    reportVersion: row.report_version,
    status: row.status,
    generatedAt: row.generated_at,
    generatedBy: row.generated_by,
    sourceReference: row.source_reference,
    reportPayload: row.report_payload,
    supersedesReportId: (row.supersedes_report_id as UUID | null) ?? undefined,
    supersededReason: row.superseded_reason ?? undefined,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
  };
}

export class SupabaseWeeklyReportsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async create(input: NewWeeklyReportInput): Promise<WeeklyReportRecord> {
    const { data, error } = await this.client
      .from("weekly_reports")
      .insert({
        period_start: input.periodStart,
        period_end: input.periodEnd,
        ledger_mode: input.ledgerMode,
        report_version: input.reportVersion,
        status: "FINALIZED",
        generated_by: input.generatedBy,
        source_reference: input.sourceReference,
        report_payload: input.reportPayload,
        supersedes_report_id: input.supersedesReportId ?? null,
        superseded_reason: input.supersededReason ?? null,
        idempotency_key: input.idempotencyKey,
      })
      .select("*")
      .single();
    if (error || !data) {
      throw new InternalError({ message: "Failed to create weekly report.", code: "WEEKLY_REPORT_CREATE_FAILED", context: { reason: error?.message } });
    }
    return rowToWeeklyReport(data as WeeklyReportRow);
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<WeeklyReportRecord | undefined> {
    const { data, error } = await this.client.from("weekly_reports").select("*").eq("idempotency_key", idempotencyKey).maybeSingle();
    if (error || !data) return undefined;
    return rowToWeeklyReport(data as WeeklyReportRow);
  }

  async findById(reportId: UUID): Promise<WeeklyReportRecord | undefined> {
    const { data, error } = await this.client.from("weekly_reports").select("*").eq("report_id", reportId).maybeSingle();
    if (error || !data) return undefined;
    return rowToWeeklyReport(data as WeeklyReportRow);
  }

  /** The current (highest-version) report for a period+ledger_mode — `undefined` if none has ever been generated. */
  async findCurrentForPeriod(periodStart: string, periodEnd: string, ledgerMode: string): Promise<WeeklyReportRecord | undefined> {
    const { data, error } = await this.client
      .from("weekly_reports")
      .select("*")
      .eq("period_start", periodStart)
      .eq("period_end", periodEnd)
      .eq("ledger_mode", ledgerMode)
      .order("report_version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return undefined;
    return rowToWeeklyReport(data as WeeklyReportRow);
  }

  async listRecent(limit: number): Promise<readonly WeeklyReportRecord[]> {
    const { data, error } = await this.client.from("weekly_reports").select("*").order("generated_at", { ascending: false }).limit(limit);
    if (error || !data) return [];
    return (data as readonly WeeklyReportRow[]).map(rowToWeeklyReport);
  }
}

/**
 * Real, Supabase-backed repository for the Section 08 `performance_ledger`
 * table — Section 08 itself never wrote one (see `OPEN_QUESTIONS.md`
 * #25's sibling gap: `PerformanceAgent` only ever computed
 * `PerformanceLedgerEntry` in memory). This is pure persistence over an
 * ALREADY-REAL, already-tested aggregation (`buildPerformanceLedgerEntry()`,
 * `@sport-os/settlement-engine`) — never a second aggregation algorithm.
 */
function rowToPerformanceLedgerEntry(row: PerformanceLedgerRow): PerformanceLedgerEntry {
  return {
    periodStart: row.period_start,
    periodEnd: row.period_end,
    ledgerMode: row.ledger_mode as PerformanceLedgerEntry["ledgerMode"],
    sport: row.sport,
    league: row.league ?? undefined,
    market: row.market ?? undefined,
    modelVersion: row.model_version ?? undefined,
    decisionPolicyVersion: row.decision_policy_version ?? undefined,
    ticketType: row.ticket_type ?? undefined,
    ticketCount: row.ticket_count,
    legCount: row.leg_count,
    executedTicketCount: row.executed_ticket_count,
    settledTicketCount: row.settled_ticket_count,
    wins: row.wins,
    losses: row.losses,
    voids: row.voids,
    pushes: row.pushes,
    pending: row.pending,
    actualStake: row.actual_stake_amount !== null && row.actual_stake_currency !== null ? { amount: row.actual_stake_amount, currency: row.actual_stake_currency } : null,
    actualPayout: row.actual_payout_amount !== null && row.actual_payout_currency !== null ? { amount: row.actual_payout_amount, currency: row.actual_payout_currency } : null,
    actualPnl: row.actual_pnl_amount !== null && row.actual_pnl_currency !== null ? { amount: row.actual_pnl_amount, currency: row.actual_pnl_currency } : null,
    roi: row.roi,
    expectedEv: row.expected_ev,
    maxDrawdown: row.max_drawdown,
    longestLosingStreak: row.longest_losing_streak,
    sampleSize: row.sample_size,
  };
}

export class SupabasePerformanceLedgerRepository {
  constructor(private readonly client: SupabaseClient) {}

  /** Upserts on the table's own dimension-tuple unique index — a re-run snapshot for the same (period, mode, sport, league, market, model, policy, ticketType) REPLACES the prior row, never duplicates it (mirrors the table's own doc comment: "recomputing and replacing a row... is an application-layer upsert responsibility"). */
  /**
   * The table's own dimension-tuple unique index cannot be relied on for
   * `.upsert()`'s `onConflict` here: Postgres treats every NULL as
   * distinct, so two rows that both have (say) `league = null` never
   * collide on that index — exactly the gap the table's own migration
   * comment calls out ("recomputing and replacing a row for the same
   * dimension tuple is an application-layer upsert responsibility").
   * This does that explicitly: find the row matching every dimension
   * (treating an `undefined` dimension as "must also be NULL," never
   * "any"), then UPDATE it if found, INSERT otherwise — never both.
   */
  async upsert(entry: PerformanceLedgerEntry): Promise<void> {
    const payload = {
      period_start: entry.periodStart,
      period_end: entry.periodEnd,
      ledger_mode: entry.ledgerMode,
      sport: entry.sport,
      league: entry.league ?? null,
      market: entry.market ?? null,
      model_version: entry.modelVersion ?? null,
      decision_policy_version: entry.decisionPolicyVersion ?? null,
      ticket_type: entry.ticketType ?? null,
      ticket_count: entry.ticketCount,
      leg_count: entry.legCount,
      executed_ticket_count: entry.executedTicketCount,
      settled_ticket_count: entry.settledTicketCount,
      wins: entry.wins,
      losses: entry.losses,
      voids: entry.voids,
      pushes: entry.pushes,
      pending: entry.pending,
      actual_stake_amount: entry.actualStake?.amount ?? null,
      actual_stake_currency: entry.actualStake?.currency ?? null,
      actual_payout_amount: entry.actualPayout?.amount ?? null,
      actual_payout_currency: entry.actualPayout?.currency ?? null,
      actual_pnl_amount: entry.actualPnl?.amount ?? null,
      actual_pnl_currency: entry.actualPnl?.currency ?? null,
      roi: entry.roi,
      expected_ev: entry.expectedEv ?? null,
      max_drawdown: entry.maxDrawdown,
      longest_losing_streak: entry.longestLosingStreak,
      sample_size: entry.sampleSize,
      computed_at: new Date().toISOString(),
    };

    let existingQuery = this.client
      .from("performance_ledger")
      .select("id")
      .eq("period_start", entry.periodStart)
      .eq("period_end", entry.periodEnd)
      .eq("ledger_mode", entry.ledgerMode)
      .eq("sport", entry.sport);
    for (const [column, value] of [
      ["league", entry.league],
      ["market", entry.market],
      ["model_version", entry.modelVersion],
      ["decision_policy_version", entry.decisionPolicyVersion],
      ["ticket_type", entry.ticketType],
    ] as const) {
      existingQuery = value === undefined ? existingQuery.is(column, null) : existingQuery.eq(column, value);
    }
    const { data: existing, error: findError } = await existingQuery.maybeSingle();
    if (findError) {
      throw new InternalError({ message: "Failed to look up existing performance ledger entry.", code: "PERFORMANCE_LEDGER_LOOKUP_FAILED", context: { reason: findError.message } });
    }

    const { error } = existing ? await this.client.from("performance_ledger").update(payload).eq("id", existing.id as string) : await this.client.from("performance_ledger").insert(payload);
    if (error) {
      throw new InternalError({ message: "Failed to upsert performance ledger entry.", code: "PERFORMANCE_LEDGER_UPSERT_FAILED", context: { reason: error.message } });
    }
  }

  async listForPeriod(periodStart: string, periodEnd: string, ledgerMode: string): Promise<readonly PerformanceLedgerEntry[]> {
    const { data, error } = await this.client.from("performance_ledger").select("*").eq("period_start", periodStart).eq("period_end", periodEnd).eq("ledger_mode", ledgerMode);
    if (error || !data) return [];
    return (data as readonly PerformanceLedgerRow[]).map(rowToPerformanceLedgerEntry);
  }
}
