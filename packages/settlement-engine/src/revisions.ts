import { generateId, type ISODateString, type UUID } from "@sport-os/shared";
import type { Money, SettlementRevision, SettlementStatus } from "./types.js";

/**
 * Settlement corrections (Section 08 §6/§9). "Do NOT allow WON -> LOST or
 * LOST -> WON through ordinary mutation. Corrections MUST use an
 * explicit settlement revision/correction mechanism... never destroy the
 * historical record." `createSettlementRevision` is the ONLY sanctioned
 * way a settlement's effective outcome ever changes after the fact — it
 * never mutates the original settlement row; it produces a new,
 * append-only revision record referencing it.
 */

export interface CreateSettlementRevisionParams {
  readonly originalSettlementId: UUID;
  readonly previousStatus: SettlementStatus;
  readonly newStatus: SettlementStatus;
  readonly previousPayout: Money | null;
  readonly newPayout: Money | null;
  readonly reason: string;
  readonly source: string;
  readonly resultVersionId?: string;
  readonly now: ISODateString;
  readonly createdBy: string;
}

export function createSettlementRevision(params: CreateSettlementRevisionParams): SettlementRevision {
  return {
    revisionId: generateId(),
    originalSettlementId: params.originalSettlementId,
    previousStatus: params.previousStatus,
    newStatus: params.newStatus,
    previousPayout: params.previousPayout,
    newPayout: params.newPayout,
    reason: params.reason,
    source: params.source,
    resultVersionId: params.resultVersionId,
    createdAt: params.now,
    createdBy: params.createdBy,
  };
}

export interface EffectiveSettlement {
  readonly status: SettlementStatus;
  readonly payout: Money | null;
  readonly revisionCount: number;
  readonly lastRevisedAt: ISODateString | undefined;
}

/**
 * Folds a settlement's revision chain (in chronological/insertion order —
 * callers must supply revisions already ordered by `createdAt`) into the
 * currently-effective status/payout, WITHOUT mutating or discarding any
 * revision. An empty `revisions` array means the original settlement is
 * still in effect — `revisionCount: 0`.
 */
export function resolveCurrentSettlement(originalStatus: SettlementStatus, originalPayout: Money | null, revisions: readonly SettlementRevision[]): EffectiveSettlement {
  if (revisions.length === 0) {
    return { status: originalStatus, payout: originalPayout, revisionCount: 0, lastRevisedAt: undefined };
  }
  const last = revisions[revisions.length - 1]!;
  return { status: last.newStatus, payout: last.newPayout, revisionCount: revisions.length, lastRevisedAt: last.createdAt };
}
