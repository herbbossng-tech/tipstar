import type { ISODateString, Maybe, UUID } from "./common.js";
import type { AgentType, DecisionStatus, EvidenceItem } from "./intelligence.js";
import type { MarketType, Sport } from "./sports.js";

export const FinalResult = {
  WIN: "win",
  LOSS: "loss",
  VOID: "void",
  PUSH: "push",
  PENDING: "pending",
} as const;
export type FinalResult = (typeof FinalResult)[keyof typeof FinalResult];

export const SettlementStatus = {
  UNSETTLED: "unsettled",
  SETTLED: "settled",
  CANCELLED: "cancelled",
} as const;
export type SettlementStatus = (typeof SettlementStatus)[keyof typeof SettlementStatus];

/**
 * An immutable published pick (Engineering Constitution T, "No Hidden Losses").
 * Once published, values must not silently change — corrections go through
 * PickCorrection with a full audit trail instead of mutating this record.
 */
export interface Pick {
  readonly id: UUID;
  /** Traceability back to the IntelligenceResult that qualified this pick, and the idempotency key for publication. */
  readonly sourceIntelligenceResultId: UUID;
  readonly agentType: AgentType;
  readonly sport: Sport;
  readonly leagueId: Maybe<UUID>;
  readonly eventId: UUID;
  readonly eventName: string;
  readonly market: MarketType;
  readonly selection: string;
  readonly publishedAt: ISODateString;
  readonly oddsAtPublication: Maybe<number>;
  readonly probability: Maybe<number>;
  readonly fairOdds: Maybe<number>;
  readonly expectedValue: Maybe<number>;
  readonly confidence: Maybe<number>;
  readonly riskScore: Maybe<number>;
  readonly modelVersion: string;
  readonly evidence: readonly EvidenceItem[];
  readonly decisionStatus: DecisionStatus;
  readonly finalResult: FinalResult;
  readonly settlementStatus: SettlementStatus;
  readonly settledAt: Maybe<ISODateString>;
}

/**
 * An audited correction to a published pick. The original pick record is
 * never overwritten — this preserves the original value alongside the
 * corrected one, who changed it, why, and when.
 */
export interface PickCorrection {
  readonly id: UUID;
  readonly pickId: UUID;
  readonly field: string;
  readonly originalValue: string;
  readonly correctedValue: string;
  readonly changedBy: UUID;
  readonly reason: string;
  readonly correctedAt: ISODateString;
}
