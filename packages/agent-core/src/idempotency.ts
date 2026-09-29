import type { UUID } from "@sport-os/shared";
import type { AgentType } from "./types.js";

/**
 * Idempotency (Section 06 §20). "Executing the same authorized command
 * twice must not create two executions... Use unique constraints or
 * equivalent backend enforcement... Do not rely solely on frontend
 * checks." This contract is the in-process mirror of that constraint;
 * `@sport-os/agents`' Supabase-backed implementation additionally relies
 * on a real unique index (see its migration) so the guarantee holds even
 * under concurrent requests racing this same check.
 */
export interface IdempotencyRecord {
  readonly agentType: AgentType;
  readonly idempotencyKey: string;
  readonly invocationId: UUID;
  readonly recordedAt: string;
}

export interface IdempotencyStore {
  /** Atomically records a (agentType, idempotencyKey) claim if none exists yet. Returns the WINNING record — the one just inserted on a fresh key, or the pre-existing one on a repeat (the caller compares `result.invocationId` to its own candidate to tell which happened). */
  claim(agentType: AgentType, idempotencyKey: string, invocationId: UUID): Promise<IdempotencyRecord>;
  get(agentType: AgentType, idempotencyKey: string): Promise<IdempotencyRecord | undefined>;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly claims = new Map<string, IdempotencyRecord>();

  private key(agentType: AgentType, idempotencyKey: string): string {
    return `${agentType}:${idempotencyKey}`;
  }

  async claim(agentType: AgentType, idempotencyKey: string, invocationId: UUID): Promise<IdempotencyRecord> {
    const key = this.key(agentType, idempotencyKey);
    const existing = this.claims.get(key);
    if (existing) return existing;
    const record: IdempotencyRecord = { agentType, idempotencyKey, invocationId, recordedAt: new Date().toISOString() };
    // A real concurrent race is impossible in this single-threaded
    // in-memory implementation (no await occurs between the read above
    // and this write), which is exactly the property a real unique
    // constraint gives under true concurrency in the Supabase-backed
    // implementation.
    this.claims.set(key, record);
    return record;
  }

  async get(agentType: AgentType, idempotencyKey: string): Promise<IdempotencyRecord | undefined> {
    return this.claims.get(this.key(agentType, idempotencyKey));
  }
}
