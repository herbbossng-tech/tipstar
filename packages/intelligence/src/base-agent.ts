import { generateId } from "@tipstar/shared";
import type { AgentType, EvidenceItem, IntelligenceResult, Sport } from "@tipstar/types";
import { IntelligenceResultStatus } from "@tipstar/types";
import type { IntelligenceAgent, IntelligenceAgentInput } from "./agent.js";

/**
 * Shared scaffolding for building well-formed IntelligenceResult objects.
 * Agents extend this and implement `evaluateInternal`; this base class
 * enforces that mock results are always flagged and that a missing model
 * degrades to INSUFFICIENT_DATA rather than a fabricated guess.
 */
export abstract class BaseIntelligenceAgent implements IntelligenceAgent {
  abstract readonly agentType: AgentType;
  abstract readonly sport: Sport;

  constructor(protected readonly mode: "mock" | "production") {}

  abstract getModelVersion(): string;

  async evaluate(input: IntelligenceAgentInput): Promise<IntelligenceResult> {
    if (this.mode === "mock") {
      return this.evaluateMock(input);
    }
    return this.evaluateProduction(input);
  }

  /** Development/test-only path. Subclasses must set isMock: true here. */
  protected abstract evaluateMock(input: IntelligenceAgentInput): Promise<IntelligenceResult>;

  /**
   * Production path. In Section 01 no agent ships a real statistical model
   * yet, so the default implementation honestly reports INSUFFICIENT_DATA.
   * Later sections override this once a real model exists for the agent.
   */
  protected async evaluateProduction(input: IntelligenceAgentInput): Promise<IntelligenceResult> {
    return this.insufficientData(input, ["No production model is implemented for this agent yet."]);
  }

  protected insufficientData(input: IntelligenceAgentInput, reasons: readonly string[]): IntelligenceResult {
    const evidence: EvidenceItem[] = reasons.map((reason) => ({
      label: "insufficient_data_reason",
      value: reason,
      sourceType: "derived_feature",
      sourceRef: null,
    }));
    return {
      id: generateId(),
      agentType: this.agentType,
      sport: this.sport,
      eventId: input.eventId,
      market: input.market,
      selection: input.selection,
      probability: null,
      fairOdds: null,
      marketOdds: null,
      expectedValue: null,
      confidence: null,
      riskScore: null,
      evidence,
      modelVersion: this.getModelVersion(),
      generatedAt: new Date().toISOString(),
      status: IntelligenceResultStatus.INSUFFICIENT_DATA,
      isMock: false,
    };
  }
}
