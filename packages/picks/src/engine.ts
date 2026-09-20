import { ErrorCodes, TipstarError, generateId, type Result, ok, err } from "@tipstar/shared";
import { DecisionStatus, FinalResult, SettlementStatus, type Pick, type PickCorrection } from "@tipstar/types";
import type { PickCandidate } from "./candidate.js";
import type { PickRepository } from "./repository.js";

/**
 * Fields that may ever be changed after publication, and only through
 * correct(), never by direct mutation. Core identity (id, event, market,
 * publishedAt, sourceIntelligenceResultId) is permanently fixed — see
 * Engineering Constitution T and Section 14 ("No Hidden Losses").
 */
export const CORRECTABLE_PICK_FIELDS = [
  "eventName",
  "oddsAtPublication",
  "probability",
  "fairOdds",
  "expectedValue",
  "confidence",
  "riskScore",
] as const;
export type CorrectablePickField = (typeof CORRECTABLE_PICK_FIELDS)[number];

export class PickEngine {
  constructor(private readonly repository: PickRepository) {}

  /**
   * Publishes a pick from a QUALIFIED decision candidate. Idempotent: if a
   * pick already exists for this source intelligence result, the existing
   * pick is returned instead of creating a duplicate.
   */
  async publish(candidate: PickCandidate): Promise<Result<Pick, TipstarError>> {
    if (candidate.decisionStatus !== DecisionStatus.QUALIFIED) {
      return err(
        new TipstarError({
          code: ErrorCodes.VALIDATION_FAILED,
          message: "Only a QUALIFIED decision may be published as a pick.",
          context: { decisionStatus: candidate.decisionStatus },
        }),
      );
    }

    const existing = await this.repository.findBySourceIntelligenceResultId(candidate.sourceIntelligenceResultId);
    if (existing) {
      return ok(existing);
    }

    const pick: Pick = {
      id: generateId(),
      sourceIntelligenceResultId: candidate.sourceIntelligenceResultId,
      agentType: candidate.agentType,
      sport: candidate.sport,
      leagueId: candidate.leagueId,
      eventId: candidate.eventId,
      eventName: candidate.eventName,
      market: candidate.market,
      selection: candidate.selection,
      publishedAt: new Date().toISOString(),
      oddsAtPublication: candidate.oddsAtPublication,
      probability: candidate.probability,
      fairOdds: candidate.fairOdds,
      expectedValue: candidate.expectedValue,
      confidence: candidate.confidence,
      riskScore: candidate.riskScore,
      modelVersion: candidate.modelVersion,
      evidence: candidate.evidence,
      decisionStatus: candidate.decisionStatus,
      finalResult: FinalResult.PENDING,
      settlementStatus: SettlementStatus.UNSETTLED,
      settledAt: null,
    };

    await this.repository.create(pick);
    return ok(pick);
  }

  /**
   * Applies an audited correction to a published pick. The original pick
   * fields are never overwritten silently — a PickCorrection record
   * captures original value, corrected value, who, why, and when, and is
   * persisted atomically alongside the updated pick.
   */
  async correct(
    pickId: string,
    field: CorrectablePickField,
    correctedValue: string,
    changedBy: string,
    reason: string,
  ): Promise<Result<Pick, TipstarError>> {
    const pick = await this.repository.findById(pickId);
    if (!pick) {
      return err(new TipstarError({ code: ErrorCodes.NOT_FOUND, message: "Pick not found.", context: { pickId } }));
    }

    if (!reason.trim()) {
      return err(
        new TipstarError({ code: ErrorCodes.VALIDATION_FAILED, message: "A correction reason is required." }),
      );
    }

    const originalValue = String(pick[field]);
    const correction: PickCorrection = {
      id: generateId(),
      pickId: pick.id,
      field,
      originalValue,
      correctedValue,
      changedBy,
      reason,
      correctedAt: new Date().toISOString(),
    };

    const updatedPick: Pick = { ...pick, [field]: coerceValue(pick[field], correctedValue) };

    await this.repository.applyCorrection(updatedPick, correction);
    return ok(updatedPick);
  }
}

function coerceValue(originalValue: unknown, correctedValue: string): unknown {
  if (typeof originalValue === "number") {
    const parsed = Number(correctedValue);
    return Number.isNaN(parsed) ? correctedValue : parsed;
  }
  return correctedValue;
}
