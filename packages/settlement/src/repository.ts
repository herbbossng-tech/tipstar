import type { Pick, UUID } from "@tipstar/types";

/** Persistence boundary for settlement. Must enforce settling a pick exactly once (unique constraint on pickId in a real DB). */
export interface SettlementRepository {
  findPickById(pickId: UUID): Promise<Pick | null>;
  /** Atomically marks the pick settled with its final result. Must no-op / reject if already settled. */
  markSettled(pick: Pick): Promise<void>;
}
