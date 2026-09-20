import type { Pick, UUID } from "@tipstar/types";
import type { SettlementRepository } from "./repository.js";

/** DEVELOPMENT/TEST-ONLY in-memory SettlementRepository. */
export class InMemorySettlementRepository implements SettlementRepository {
  constructor(private readonly picks: Map<UUID, Pick>) {}

  async findPickById(pickId: UUID): Promise<Pick | null> {
    return this.picks.get(pickId) ?? null;
  }

  async markSettled(pick: Pick): Promise<void> {
    this.picks.set(pick.id, pick);
  }
}
