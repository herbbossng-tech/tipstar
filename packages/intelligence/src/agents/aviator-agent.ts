import { generateId } from "@tipstar/shared";
import { AgentType, IntelligenceResultStatus, Sport, type EvidenceItem, type IntelligenceResult } from "@tipstar/types";
import type { AviatorProvider } from "@tipstar/sports";
import { BaseIntelligenceAgent } from "../base-agent.js";
import type { IntelligenceAgentInput } from "../agent.js";

const MODEL_VERSION = "aviator-agent@0.1.0-dev";

/**
 * Aviator Agent boundary (Section 10). Aviator outcomes are NOT claimed to
 * be predictable with certainty, and no fixed win-rate (e.g. "80%") is ever
 * hard-coded here — any target rate must come from historical/out-of-sample
 * evaluation in a later section, not from this scaffold.
 */
export class AviatorAgent extends BaseIntelligenceAgent {
  readonly agentType = AgentType.AVIATOR;
  readonly sport = Sport.AVIATOR;

  constructor(
    private readonly provider: AviatorProvider,
    mode: "mock" | "production" = "production",
  ) {
    super(mode);
  }

  getModelVersion(): string {
    return MODEL_VERSION;
  }

  protected async evaluateMock(input: IntelligenceAgentInput): Promise<IntelligenceResult> {
    const distribution = await this.provider.getMultiplierDistribution(500);
    const belowTwoBucket = distribution.buckets.find((b) => b.rangeMax <= 2);
    const probability = belowTwoBucket ? 1 - belowTwoBucket.frequency : null;

    const evidence: EvidenceItem[] = [
      { label: "distribution_sample_size", value: distribution.sampleSize, sourceType: "statistical_model", sourceRef: this.provider.providerId },
    ];

    if (probability === null) {
      return this.insufficientData(input, ["No multiplier distribution bucket available for this threshold."]);
    }

    return {
      id: generateId(),
      agentType: this.agentType,
      sport: this.sport,
      eventId: input.eventId,
      market: input.market,
      selection: input.selection,
      probability,
      fairOdds: Number((1 / probability).toFixed(2)),
      marketOdds: null,
      expectedValue: null,
      confidence: 0.25,
      riskScore: 0.75,
      evidence,
      modelVersion: this.getModelVersion(),
      generatedAt: new Date().toISOString(),
      status: IntelligenceResultStatus.GENERATED,
      isMock: true,
    };
  }
}
