import type { ISODateString, UUID } from "@sport-os/shared";

/**
 * Data Quality / Quarantine / Conflict types (Section 04 — Data Quality
 * Engine / Quarantine / Data Conflicts).
 */

export const QualityStatus = {
  VALID: "valid",
  VALID_WITH_WARNINGS: "valid_with_warnings",
  INVALID: "invalid",
  QUARANTINED: "quarantined",
} as const;
export type QualityStatus = (typeof QualityStatus)[keyof typeof QualityStatus];

export interface DataQualityCheckResult {
  readonly name: string;
  readonly passed: boolean;
  /** "error" fails the record outright; "warning" allows it through but is recorded. */
  readonly severity: "error" | "warning";
  readonly message: string;
}

/**
 * The structured result every DataQualityEngine check produces — never
 * reduced to a single unexplained number (see the section spec's "Do
 * not reduce quality to one unexplained number").
 */
export interface DataQualityResult {
  readonly status: QualityStatus;
  /** 0-1. A simple proportion (checks passed / checks run) — a summary alongside `checks`, never a replacement for reading them. */
  readonly score: number;
  readonly checks: readonly DataQualityCheckResult[];
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

export interface QuarantineRecord {
  readonly id: UUID;
  readonly provider: string;
  readonly providerRecordId: string | undefined;
  readonly entityType: string;
  readonly reason: string;
  readonly rawPayload: Readonly<Record<string, unknown>> | undefined;
  readonly detectedAt: ISODateString;
  readonly ingestionRunId: UUID | undefined;
  readonly resolvedAt: ISODateString | undefined;
}

export const DataConflictStatus = { UNRESOLVED: "unresolved", RESOLVED: "resolved" } as const;
export type DataConflictStatus = (typeof DataConflictStatus)[keyof typeof DataConflictStatus];

export interface DataConflict {
  readonly id: UUID;
  readonly entityType: string;
  /** e.g. "team:provider_a:123" or an internal UUID once known — see conflicts.ts. */
  readonly entityRef: string;
  readonly field: string;
  readonly sourceA: string;
  readonly valueA: string | undefined;
  readonly sourceB: string;
  readonly valueB: string | undefined;
  readonly detectedAt: ISODateString;
  readonly resolutionStatus: DataConflictStatus;
  readonly resolvedValue: string | undefined;
  readonly resolvedAt: ISODateString | undefined;
}
