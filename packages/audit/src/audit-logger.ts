import { generateId } from "@tipstar/shared";
import type { AuditAction, AuditLogEntry, UUID } from "@tipstar/types";
import { redact } from "./redact.js";

export interface AuditLogRepository {
  insert(entry: AuditLogEntry): Promise<void>;
}

export interface RecordAuditEventInput {
  readonly action: AuditAction;
  readonly actorUserId?: UUID | null;
  readonly targetType?: string | null;
  readonly targetId?: string | null;
  readonly context?: Record<string, unknown>;
  readonly correlationId?: string | null;
}

/**
 * Records auditable system actions (Engineering Constitution section S):
 * authentication, provider failures, model execution, pick lifecycle,
 * settlement, subscription/affiliate changes, admin actions, errors.
 * Context is redacted before persistence, mirroring the logger.
 */
export class AuditLogger {
  constructor(private readonly repository: AuditLogRepository) {}

  async record(input: RecordAuditEventInput): Promise<AuditLogEntry> {
    const entry: AuditLogEntry = {
      id: generateId(),
      action: input.action,
      actorUserId: input.actorUserId ?? null,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      context: Object.freeze((redact(input.context ?? {})) as Record<string, unknown>),
      correlationId: input.correlationId ?? null,
      occurredAt: new Date().toISOString(),
    };
    await this.repository.insert(entry);
    return entry;
  }
}

/** DEVELOPMENT/TEST-ONLY in-memory audit log repository. */
export class InMemoryAuditLogRepository implements AuditLogRepository {
  readonly entries: AuditLogEntry[] = [];
  async insert(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}
