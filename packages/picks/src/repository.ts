import type { Pick, PickCorrection, UUID } from "@tipstar/types";

/**
 * Persistence boundary for picks. A Supabase-backed implementation lives in
 * the backend; this package only defines the contract and enforces the
 * immutability/correction rules above it.
 */
export interface PickRepository {
  /** Used to make publish() idempotent: one pick per source intelligence result. */
  findBySourceIntelligenceResultId(sourceIntelligenceResultId: UUID): Promise<Pick | null>;
  findById(pickId: UUID): Promise<Pick | null>;
  create(pick: Pick): Promise<void>;
  /**
   * Applies one corrected field and its audit record together. Must be
   * implemented atomically (single transaction) so the pick and its audit
   * trail never diverge.
   */
  applyCorrection(updatedPick: Pick, correction: PickCorrection): Promise<void>;
}
