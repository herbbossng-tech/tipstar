import { generateId, ValidationError, type UUID } from "@sport-os/shared";
import type { SupabaseClient } from "@sport-os/platform";
import type { DataConflictRow, DataQuarantineRow } from "../db/types.js";
import type { DataConflict, DataConflictStatus, QuarantineRecord } from "../quality-types.js";

export interface NewQuarantineInput {
  readonly provider: string;
  readonly providerRecordId: string | undefined;
  readonly entityType: string;
  readonly reason: string;
  readonly rawPayload: Readonly<Record<string, unknown>> | undefined;
  readonly ingestionRunId: UUID | undefined;
}

export interface QuarantineRepository {
  quarantine(input: NewQuarantineInput): Promise<QuarantineRecord>;
  listForRun(ingestionRunId: UUID): Promise<readonly QuarantineRecord[]>;
}

export interface NewDataConflictInput {
  readonly entityType: string;
  readonly entityRef: string;
  readonly field: string;
  readonly sourceA: string;
  readonly valueA: string | undefined;
  readonly sourceB: string;
  readonly valueB: string | undefined;
}

export interface DataConflictsRepository {
  record(input: NewDataConflictInput): Promise<DataConflict>;
  listUnresolved(): Promise<readonly DataConflict[]>;
  resolve(id: UUID, resolvedValue: string): Promise<DataConflict>;
}

function quarantineRowToDomain(row: DataQuarantineRow): QuarantineRecord {
  return {
    id: row.id,
    provider: row.provider,
    providerRecordId: row.provider_record_id ?? undefined,
    entityType: row.entity_type,
    reason: row.reason,
    rawPayload: row.raw_payload ?? undefined,
    detectedAt: row.detected_at,
    ingestionRunId: row.ingestion_run_id ?? undefined,
    resolvedAt: row.resolved_at ?? undefined,
  };
}

function conflictRowToDomain(row: DataConflictRow): DataConflict {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityRef: row.entity_ref,
    field: row.field,
    sourceA: row.source_a,
    valueA: row.value_a ?? undefined,
    sourceB: row.source_b,
    valueB: row.value_b ?? undefined,
    detectedAt: row.detected_at,
    resolutionStatus: row.resolution_status as DataConflictStatus,
    resolvedValue: row.resolved_value ?? undefined,
    resolvedAt: row.resolved_at ?? undefined,
  };
}

// ============================================================
// In-memory implementations
// ============================================================

export class InMemoryQuarantineRepository implements QuarantineRepository {
  private readonly records: QuarantineRecord[] = [];

  async quarantine(input: NewQuarantineInput): Promise<QuarantineRecord> {
    const record: QuarantineRecord = { id: generateId(), ...input, detectedAt: new Date().toISOString(), resolvedAt: undefined };
    this.records.push(record);
    return record;
  }

  async listForRun(ingestionRunId: UUID): Promise<readonly QuarantineRecord[]> {
    return this.records.filter((r) => r.ingestionRunId === ingestionRunId);
  }
}

export class InMemoryDataConflictsRepository implements DataConflictsRepository {
  private readonly conflicts = new Map<UUID, DataConflict>();

  async record(input: NewDataConflictInput): Promise<DataConflict> {
    const conflict: DataConflict = { id: generateId(), ...input, detectedAt: new Date().toISOString(), resolutionStatus: "unresolved", resolvedValue: undefined, resolvedAt: undefined };
    this.conflicts.set(conflict.id, conflict);
    return conflict;
  }

  async listUnresolved(): Promise<readonly DataConflict[]> {
    return [...this.conflicts.values()].filter((c) => c.resolutionStatus === "unresolved");
  }

  async resolve(id: UUID, resolvedValue: string): Promise<DataConflict> {
    const existing = this.conflicts.get(id);
    if (!existing) {
      throw new ValidationError({ message: "Data conflict not found.", code: "DATA_CONFLICT_NOT_FOUND" });
    }
    const resolved: DataConflict = { ...existing, resolutionStatus: "resolved", resolvedValue, resolvedAt: new Date().toISOString() };
    this.conflicts.set(id, resolved);
    return resolved;
  }
}

// ============================================================
// Supabase-backed implementations
// ============================================================

export class SupabaseQuarantineRepository implements QuarantineRepository {
  constructor(private readonly client: SupabaseClient) {}

  async quarantine(input: NewQuarantineInput): Promise<QuarantineRecord> {
    const { data, error } = await this.client
      .from("data_quarantine")
      .insert({
        provider: input.provider,
        provider_record_id: input.providerRecordId ?? null,
        entity_type: input.entityType,
        reason: input.reason,
        raw_payload: input.rawPayload ?? null,
        ingestion_run_id: input.ingestionRunId ?? null,
      })
      .select("*")
      .single();
    if (error || !data) {
      throw new ValidationError({ message: "Failed to quarantine record.", code: "QUARANTINE_INSERT_FAILED", context: { reason: error?.message } });
    }
    return quarantineRowToDomain(data as DataQuarantineRow);
  }

  async listForRun(ingestionRunId: UUID): Promise<readonly QuarantineRecord[]> {
    const { data, error } = await this.client.from("data_quarantine").select("*").eq("ingestion_run_id", ingestionRunId);
    if (error || !data) return [];
    return (data as readonly DataQuarantineRow[]).map(quarantineRowToDomain);
  }
}

export class SupabaseDataConflictsRepository implements DataConflictsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async record(input: NewDataConflictInput): Promise<DataConflict> {
    const { data, error } = await this.client
      .from("data_conflicts")
      .insert({ entity_type: input.entityType, entity_ref: input.entityRef, field: input.field, source_a: input.sourceA, value_a: input.valueA ?? null, source_b: input.sourceB, value_b: input.valueB ?? null })
      .select("*")
      .single();
    if (error || !data) {
      throw new ValidationError({ message: "Failed to record data conflict.", code: "DATA_CONFLICT_INSERT_FAILED", context: { reason: error?.message } });
    }
    return conflictRowToDomain(data as DataConflictRow);
  }

  async listUnresolved(): Promise<readonly DataConflict[]> {
    const { data, error } = await this.client.from("data_conflicts").select("*").eq("resolution_status", "unresolved");
    if (error || !data) return [];
    return (data as readonly DataConflictRow[]).map(conflictRowToDomain);
  }

  async resolve(id: UUID, resolvedValue: string): Promise<DataConflict> {
    const { data, error } = await this.client.from("data_conflicts").update({ resolution_status: "resolved", resolved_value: resolvedValue, resolved_at: new Date().toISOString() }).eq("id", id).select("*").single();
    if (error || !data) {
      throw new ValidationError({ message: "Failed to resolve data conflict.", code: "DATA_CONFLICT_RESOLVE_FAILED", context: { reason: error?.message } });
    }
    return conflictRowToDomain(data as DataConflictRow);
  }
}
