import { generateId } from "@tipstar/shared";
import { AgentType, IntelligenceResultStatus, Sport, type EvidenceItem, type IntelligenceResult } from "@tipstar/types";
import type { VirtualFootballProvider } from "@tipstar/sports";
import { BaseIntelligenceAgent } from "../base-agent.js";
import type { IntelligenceAgentInput } from "../agent.js";

const MODEL_VERSION = "virtual-football-agent@0.1.0-dev";

/**
 * Virtual Football Agent boundary (Section 10). Treated as its own domain —
 * it draws on result-distribution/sequence data, never real-football
 * features like injuries or lineups.
 */
export class VirtualFootballAgent extends BaseIntelligenceAgent {
  readonly agentType = AgentType.VIRTUAL_FOOTBALL;
  readonly sport = Sport.VIRTUAL_FOOTBALL;

  constructor(
    private readonly provider: VirtualFootballProvider,
    mode: "mock" | "production" = "production",
  ) {
    super(mode);
  }

  getModelVersion(): string {
    return MODEL_VERSION;
  }

  protected async evaluateMock(input: IntelligenceAgentInput): Promise<IntelligenceResult> {
    const event = await this.provider.getEvent(input.eventId);
    if (!event || event.leagueId === null) {
      return this.insufficientData(input, ["Mock provider has no fixture/league for this eventId."]);
    }
    const distribution = await this.provider.getResultDistribution(event.leagueId);
    if (!distribution) {
      return this.insufficientData(input, ["No result distribution available for this league."]);
    }

    const evidence: EvidenceItem[] = [
      { label: "sample_size", value: distribution.sampleSize, sourceType: "statistical_model", sourceRef: this.provider.providerId },
      { label: "outcome_frequency", value: JSON.stringify(distribution.outcomeFrequencies), sourceType: "statistical_model", sourceRef: this.provider.providerId },
    ];

    const probability = distribution.outcomeFrequencies[input.selection] ?? 0.33;

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
      confidence: 0.3,
      riskScore: 0.6,
      evidence,
      modelVersion: this.getModelVersion(),
      generatedAt: new Date().toISOString(),
      status: IntelligenceResultStatus.GENERATED,
      isMock: true,
    };
  }
}
