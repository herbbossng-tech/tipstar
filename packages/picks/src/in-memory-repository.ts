import type { Pick, PickCorrection, UUID } from "@tipstar/types";
import type { PickRepository } from "./repository.js";

/**
 * DEVELOPMENT/TEST-ONLY in-memory PickRepository. A Supabase-backed
 * implementation belongs in the backend; this exists purely so PickEngine
 * can be unit tested without a database.
 */
export class InMemoryPickRepository implements PickRepository {
  private readonly picksById = new Map<UUID, Pick>();
  private readonly picksBySourceResultId = new Map<UUID, UUID>();
  readonly corrections: PickCorrection[] = [];

  async findBySourceIntelligenceResultId(sourceIntelligenceResultId: UUID): Promise<Pick | null> {
    const pickId = this.picksBySourceResultId.get(sourceIntelligenceResultId);
    return pickId ? (this.picksById.get(pickId) ?? null) : null;
  }

  async findById(pickId: UUID): Promise<Pick | null> {
    return this.picksById.get(pickId) ?? null;
  }

  async create(pick: Pick): Promise<void> {
    this.picksById.set(pick.id, pick);
    this.picksBySourceResultId.set(pick.sourceIntelligenceResultId, pick.id);
  }

  async applyCorrection(updatedPick: Pick, correction: PickCorrection): Promise<void> {
    this.picksById.set(updatedPick.id, updatedPick);
    this.corrections.push(correction);
  }
}
