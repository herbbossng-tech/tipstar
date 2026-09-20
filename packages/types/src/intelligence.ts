import type { ISODateString, Maybe, UUID } from "./common.js";
import type { MarketType, Sport } from "./sports.js";

export const AgentType = {
  FOOTBALL: "football_agent",
  BASKETBALL: "basketball_agent",
  VIRTUAL_FOOTBALL: "virtual_football_agent",
  AVIATOR: "aviator_agent",
} as const;
export type AgentType = (typeof AgentType)[keyof typeof AgentType];

/**
 * A single piece of supporting evidence behind an intelligence result.
 * Evidence must trace back to normalized provider data or a named model —
 * never to an unattributed LLM claim (see "Evidence-First AI Architecture").
 */
export interface EvidenceItem {
  readonly label: string;
  readonly value: string | number | boolean;
  readonly sourceType: "provider_data" | "statistical_model" | "derived_feature";
  readonly sourceRef: Maybe<string>;
}

export const IntelligenceResultStatus = {
  GENERATED: "generated",
  INSUFFICIENT_DATA: "insufficient_data",
  ERROR: "error",
} as const;
export type IntelligenceResultStatus = (typeof IntelligenceResultStatus)[keyof typeof IntelligenceResultStatus];

/**
 * Generic structured output of any IntelligenceAgent. Agent-specific
 * reasoning stays inside the agent; this is the common shape the Decision
 * Engine and Pick Engine consume regardless of domain.
 */
export interface IntelligenceResult {
  readonly id: UUID;
  readonly agentType: AgentType;
  readonly sport: Sport;
  readonly eventId: UUID;
  readonly market: MarketType;
  readonly selection: string;
  readonly probability: Maybe<number>;
  readonly fairOdds: Maybe<number>;
  readonly marketOdds: Maybe<number>;
  readonly expectedValue: Maybe<number>;
  readonly confidence: Maybe<number>;
  readonly riskScore: Maybe<number>;
  readonly evidence: readonly EvidenceItem[];
  readonly modelVersion: string;
  readonly generatedAt: ISODateString;
  readonly status: IntelligenceResultStatus;
  /**
   * Set only by mock/dev adapters. Production code paths must never emit
   * isMock: true, and consumers must never present a mock result as real.
   */
  readonly isMock: boolean;
}

export const DecisionStatus = {
  QUALIFIED: "qualified",
  WAIT: "wait",
  NO_TRADE: "no_trade",
  MONITOR: "monitor",
  REJECTED: "rejected",
  INSUFFICIENT_DATA: "insufficient_data",
} as const;
export type DecisionStatus = (typeof DecisionStatus)[keyof typeof DecisionStatus];

export interface DecisionOutcome {
  readonly intelligenceResultId: UUID;
  readonly status: DecisionStatus;
  readonly reasons: readonly string[];
  readonly evaluatedAt: ISODateString;
  readonly decisionEngineVersion: string;
}
