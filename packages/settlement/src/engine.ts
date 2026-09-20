import { ErrorCodes, TipstarError, type Result, ok, err } from "@tipstar/shared";
import { FinalResult, SettlementStatus, type Pick, type UUID } from "@tipstar/types";
import type { SettlementRepository } from "./repository.js";

export interface EventResultInput {
  readonly pickId: UUID;
  readonly finalResult: Exclude<FinalResult, "pending">;
}

/**
 * Settles published picks against final event results. Idempotent by
 * design (Section 16): calling settle() twice for the same pick never
 * creates a duplicate result or corrupts performance statistics — the
 * second call is a safe no-op that returns the already-settled pick.
 */
export class SettlementEngine {
  constructor(private readonly repository: SettlementRepository) {}

  async settle(input: EventResultInput): Promise<Result<Pick, TipstarError>> {
    const pick = await this.repository.findPickById(input.pickId);
    if (!pick) {
      return err(new TipstarError({ code: ErrorCodes.NOT_FOUND, message: "Pick not found.", context: { pickId: input.pickId } }));
    }

    if (pick.settlementStatus === SettlementStatus.SETTLED) {
      // Idempotent no-op: return the existing settlement rather than re-settling.
      return ok(pick);
    }

    const settledPick: Pick = {
      ...pick,
      finalResult: input.finalResult,
      settlementStatus: SettlementStatus.SETTLED,
      settledAt: new Date().toISOString(),
    };

    await this.repository.markSettled(settledPick);
    return ok(settledPick);
  }

  /** Cancels settlement bookkeeping for a void/abandoned event without deleting the pick record (Section 14, "No Hidden Losses"). */
  async cancel(pickId: UUID): Promise<Result<Pick, TipstarError>> {
    const pick = await this.repository.findPickById(pickId);
    if (!pick) {
      return err(new TipstarError({ code: ErrorCodes.NOT_FOUND, message: "Pick not found.", context: { pickId } }));
    }
    if (pick.settlementStatus === SettlementStatus.SETTLED) {
      return err(
        new TipstarError({
          code: ErrorCodes.ALREADY_SETTLED,
          message: "Pick is already settled and cannot be cancelled.",
          context: { pickId },
        }),
      );
    }
    const cancelledPick: Pick = {
      ...pick,
      finalResult: FinalResult.VOID,
      settlementStatus: SettlementStatus.CANCELLED,
      settledAt: new Date().toISOString(),
    };
    await this.repository.markSettled(cancelledPick);
    return ok(cancelledPick);
  }
}
