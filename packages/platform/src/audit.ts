import { generateId, type ISODateString } from "@sport-os/shared";

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
