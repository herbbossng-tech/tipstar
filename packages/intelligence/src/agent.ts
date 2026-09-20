import type { AgentType, IntelligenceResult, MarketType, Sport, UUID } from "@tipstar/types";

export interface IntelligenceAgentInput {
  readonly eventId: UUID;
  readonly market: MarketType;
  readonly selection: string;
}

/**
 * The common contract every intelligence agent (Football, Basketball,
 * Virtual Football, Aviator, and any future agent) must implement. The
 * Decision Engine, Pick Engine, and UI depend only on this interface, never
 * on agent-specific internals (Engineering Constitution R).
 */
export interface IntelligenceAgent {
  readonly agentType: AgentType;
  readonly sport: Sport;

  getModelVersion(): string;

  /**
   * Ingests normalized data, runs feature engineering and statistical
   * analysis, and returns a structured IntelligenceResult. Must return
   * status "insufficient_data" rather than guessing when evidence is weak
   * or a production model is not yet available for this agent.
   */
  evaluate(input: IntelligenceAgentInput): Promise<IntelligenceResult>;
}
