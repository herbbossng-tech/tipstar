import { InternalError, generateId, redact, type ISODateString } from "@sport-os/shared";
import type { SupabaseClient } from "./db/client.js";
import type { AuditLogRow } from "./db/types.js";

export const AuditOutcome = {
  SUCCESS: "success",
  FAILURE: "failure",
  DENIED: "denied",
} as const;
export type AuditOutcome = (typeof AuditOutcome)[keyof typeof AuditOutcome];

/** Append-only audit event shape (Section 01 — Audit Foundation). */
export interface AuditEvent {
  readonly id: string;
  readonly actor: string;
  readonly action: string;
  readonly resource: string;
  readonly resourceId: string;
  readonly timestamp: ISODateString;
  readonly outcome: AuditOutcome;
  readonly requestId: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type AuditEventInput = Omit<AuditEvent, "id" | "timestamp">;

export interface AuditService {
  record(event: AuditEventInput): Promise<AuditEvent>;
}

/**
 * In-memory, append-only audit trail. Real events only — this class never
 * seeds or fabricates historical records; every entry it holds was
 * genuinely recorded via `record()`. A persistent (Supabase-backed) audit
 * log is a later-section concern; this is a valid, usable implementation
 * for anything running in-process today (e.g. a single request's
 * lifecycle) and the reference implementation for that later one.
 */
export class InMemoryAuditService implements AuditService {
  private readonly events: AuditEvent[] = [];

  async record(input: AuditEventInput): Promise<AuditEvent> {
    const event: AuditEvent = { id: generateId(), timestamp: new Date().toISOString(), ...input };
    this.events.push(event);
    return event;
  }

  /** Read-only snapshot, in recording order — the audit log is append-only, never mutated after the fact. */
  getEvents(): readonly AuditEvent[] {
    return [...this.events];
  }
}

/**
 * Real, Supabase-backed audit trail (Section 03 — Audit Persistence).
 * Always constructed with a service-role client — audit_logs has no
 * INSERT policy for any other role at all, by design (see its RLS
 * migration): audit events are only ever written from this trusted
 * server-side path, never client-initiated.
 *
 * `metadata` is passed through `redact()` before being written — the
 * same defense-in-depth pattern Section 02 applies to logs, applied here
 * to the persisted audit trail too, so a caller mistake (accidentally
 * including a token/secret/license_key-shaped field) is caught rather
 * than permanently stored.
 */
export class SupabaseAuditService implements AuditService {
  constructor(private readonly client: SupabaseClient) {}

  async record(input: AuditEventInput): Promise<AuditEvent> {
    const event: AuditEvent = { id: generateId(), timestamp: new Date().toISOString(), ...input };
    const safeMetadata = (redact(event.metadata ?? {}) as Record<string, unknown>) ?? {};

    const { error } = await this.client.from("audit_logs").insert({
      id: event.id,
      actor_user_id: event.actor,
      action: event.action,
      resource_type: event.resource,
      resource_id: event.resourceId,
      outcome: event.outcome,
      request_id: event.requestId,
      metadata: safeMetadata,
      created_at: event.timestamp,
    } satisfies Partial<AuditLogRow>);
    if (error) {
      // Audit failures must never silently vanish, but they also must
      // never block the operation they're describing (an audit write
      // failing is not a reason to fail the license/role change it
      // recorded) — surfaced via a thrown, typed error the caller can
      // choose to log/monitor, not swallowed.
      throw new InternalError({ message: "Failed to persist audit event.", code: "AUDIT_PERSIST_FAILED", context: { reason: error.message } });
    }
    return event;
  }
}
