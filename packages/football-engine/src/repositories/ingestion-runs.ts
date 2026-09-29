import { generateId, ValidationError, type UUID } from "@sport-os/shared";
import type { SupabaseClient } from "@sport-os/platform";
import type { IngestionMode, IngestionRun, IngestionRunStatus } from "../canonical.js";
import type { IngestionRunRow } from "../db/types.js";

/** IngestionRun repository (Section 04 — Ingestion Run / Observability). One row per ingestion job. */

export interface StartIngestionRunInput {
  readonly provider: string;
  readonly mode: IngestionMode;
}

export interface IngestionRunUpdate {
  readonly status?: IngestionRunStatus;
  readonly completedAt?: string;
  readonly recordsReceived?: number;
  readonly recordsInserted?: number;
  readonly recordsUpdated?: number;
  readonly recordsRejected?: number;
  readonly errorCount?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface IngestionRunsRepository {
  start(input: StartIngestionRunInput): Promise<IngestionRun>;
  update(id: UUID, patch: IngestionRunUpdate): Promise<IngestionRun>;
  getById(id: UUID): Promise<IngestionRun | undefined>;
}

function rowToDomain(row: IngestionRunRow): IngestionRun {
  return {
    id: row.id,
    provider: row.provider,
    mode: row.mode,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    recordsReceived: row.records_received,
    recordsInserted: row.records_inserted,
    recordsUpdated: row.records_updated,
    recordsRejected: row.records_rejected,
    errorCount: row.error_count,
    metadata: row.metadata,
  };
}

export class InMemoryIngestionRunsRepository implements IngestionRunsRepository {
  private readonly byId = new Map<UUID, IngestionRun>();

  async start(input: StartIngestionRunInput): Promise<IngestionRun> {
    const run: IngestionRun = {
      id: generateId(),
      provider: input.provider,
      mode: input.mode,
      status: "running",
      startedAt: new Date().toISOString(),
      completedAt: undefined,
      recordsReceived: 0,
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsRejected: 0,
      errorCount: 0,
      metadata: {},
    };
    this.byId.set(run.id, run);
    return run;
  }

  async update(id: UUID, patch: IngestionRunUpdate): Promise<IngestionRun> {
    const existing = this.byId.get(id);
    if (!existing) {
      throw new ValidationError({ message: "Ingestion run not found.", code: "INGESTION_RUN_NOT_FOUND" });
    }
    const updated: IngestionRun = { ...existing, ...patch };
    this.byId.set(id, updated);
    return updated;
  }

  async getById(id: UUID): Promise<IngestionRun | undefined> {
    return this.byId.get(id);
  }
}

export class SupabaseIngestionRunsRepository implements IngestionRunsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async start(input: StartIngestionRunInput): Promise<IngestionRun> {
    const { data, error } = await this.client.from("ingestion_runs").insert({ provider: input.provider, mode: input.mode, status: "running" }).select("*").single();
    if (error || !data) {
      throw new ValidationError({ message: "Failed to start ingestion run.", code: "INGESTION_RUN_START_FAILED", context: { reason: error?.message } });
    }
    return rowToDomain(data as IngestionRunRow);
  }

  async update(id: UUID, patch: IngestionRunUpdate): Promise<IngestionRun> {
    const payload: Record<string, unknown> = {};
    if (patch.status !== undefined) payload.status = patch.status;
    if (patch.completedAt !== undefined) payload.completed_at = patch.completedAt;
    if (patch.recordsReceived !== undefined) payload.records_received = patch.recordsReceived;
    if (patch.recordsInserted !== undefined) payload.records_inserted = patch.recordsInserted;
    if (patch.recordsUpdated !== undefined) payload.records_updated = patch.recordsUpdated;
    if (patch.recordsRejected !== undefined) payload.records_rejected = patch.recordsRejected;
    if (patch.errorCount !== undefined) payload.error_count = patch.errorCount;
    if (patch.metadata !== undefined) payload.metadata = patch.metadata;

    const { data, error } = await this.client.from("ingestion_runs").update(payload).eq("id", id).select("*").single();
    if (error || !data) {
      throw new ValidationError({ message: "Failed to update ingestion run.", code: "INGESTION_RUN_UPDATE_FAILED", context: { reason: error?.message } });
    }
    return rowToDomain(data as IngestionRunRow);
  }

  async getById(id: UUID): Promise<IngestionRun | undefined> {
    const { data, error } = await this.client.from("ingestion_runs").select("*").eq("id", id).maybeSingle();
    if (error || !data) return undefined;
    return rowToDomain(data as IngestionRunRow);
  }
}
