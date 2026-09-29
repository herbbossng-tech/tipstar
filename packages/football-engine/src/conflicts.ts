import type { DataConflict } from "./quality-types.js";
import type { DataConflictsRepository } from "./repositories/quality.js";

/**
 * Multi-provider conflict detection (Section 04 — Data Conflicts: "never
 * silently pick one provider's value... no invented reliability
 * rankings"). Compares one field's value as reported by two providers
 * for the same real-world entity and records a DataConflict when they
 * disagree — resolution is left to an operator (or a future section),
 * never decided here.
 *
 * Only one provider (`test_fixture_provider`) is connected this section
 * (see adapters/test-fixture-provider.ts and
 * docs/architecture/FOOTBALL_DATA_ARCHITECTURE.md), so nothing in the
 * ingestion pipeline can genuinely trigger this yet — it exists and is
 * tested directly so a second provider's ingestion can call it as soon
 * as one exists, without redesigning the conflict model.
 */
export interface FieldValueComparison {
  readonly entityType: string;
  /** A stable reference to the entity being compared, e.g. an internal UUID once resolved, or "team:provider_a:123" before resolution. */
  readonly entityRef: string;
  readonly field: string;
  readonly sourceA: string;
  readonly valueA: string | undefined;
  readonly sourceB: string;
  readonly valueB: string | undefined;
}

/**
 * Records a conflict only when both sources have actually reported a
 * value for this field and those values disagree. A field only one side
 * has reported yet is not a conflict — it is simply incomplete
 * coverage, and treating it as one would create false positives on
 * every provider gap.
 */
export async function detectAndRecordConflict(conflicts: DataConflictsRepository, comparison: FieldValueComparison): Promise<DataConflict | undefined> {
  if (comparison.valueA === undefined || comparison.valueB === undefined) return undefined;
  if (comparison.valueA === comparison.valueB) return undefined;
  return conflicts.record({
    entityType: comparison.entityType,
    entityRef: comparison.entityRef,
    field: comparison.field,
    sourceA: comparison.sourceA,
    valueA: comparison.valueA,
    sourceB: comparison.sourceB,
    valueB: comparison.valueB,
  });
}
