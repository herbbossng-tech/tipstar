import type { AgentType, DecisionStatus, EvidenceItem, MarketType, Sport, UUID } from "@tipstar/types";

/**
 * Everything the Pick Engine needs to publish a pick, produced by joining
 * a QUALIFIED DecisionOutcome back to its source IntelligenceResult. Kept
 * separate from Pick itself so "candidate" data can be validated/rejected
 * before an immutable record is ever created.
 */
export interface PickCandidate {
  readonly sourceIntelligenceResultId: UUID;
  readonly agentType: AgentType;
  readonly sport: Sport;
  readonly leagueId: UUID | null;
  readonly eventId: UUID;
  readonly eventName: string;
  readonly market: MarketType;
  readonly selection: string;
  readonly oddsAtPublication: number | null;
  readonly probability: number | null;
  readonly fairOdds: number | null;
  readonly expectedValue: number | null;
  readonly confidence: number | null;
  readonly riskScore: number | null;
  readonly modelVersion: string;
  readonly evidence: readonly EvidenceItem[];
  readonly decisionStatus: DecisionStatus;
}
