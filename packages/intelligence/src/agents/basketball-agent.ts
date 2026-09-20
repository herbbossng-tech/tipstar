import { generateId } from "@tipstar/shared";
import { AgentType, IntelligenceResultStatus, Sport, type EvidenceItem, type IntelligenceResult } from "@tipstar/types";
import type { BasketballProvider } from "@tipstar/sports";
import { BaseIntelligenceAgent } from "../base-agent.js";
import type { IntelligenceAgentInput } from "../agent.js";

const MODEL_VERSION = "basketball-agent@0.1.0-dev";

/**
 * Basketball Agent boundary (Section 10). Real efficiency/pace/injury
 * modeling is out of scope for Section 01 — see FootballAgent for the same
 * pattern applied to this domain.
 */
export class BasketballAgent extends BaseIntelligenceAgent {
  readonly agentType = AgentType.BASKETBALL;
  readonly sport = Sport.BASKETBALL;

  constructor(
    private readonly provider: BasketballProvider,
    mode: "mock" | "production" = "production",
  ) {
    super(mode);
  }

  getModelVersion(): string {
    return MODEL_VERSION;
  }

  protected async evaluateMock(input: IntelligenceAgentInput): Promise<IntelligenceResult> {
    const event = await this.provider.getEvent(input.eventId);
    const odds = await this.provider.getOdds(input.eventId);
    const selectionOdds = odds.find((o) => o.selection === input.selection)?.odds ?? null;

    if (!event) {
      return this.insufficientData(input, ["Mock provider has no fixture for this eventId."]);
    }

    const evidence: EvidenceItem[] = [
      { label: "market_odds", value: selectionOdds ?? "unavailable", sourceType: "provider_data", sourceRef: this.provider.providerId },
    ];

    const probability = 0.55; // fixed dev-only placeholder, never a real prediction
    const fairOdds = Number((1 / probability).toFixed(2));

    return {
      id: generateId(),
      agentType: this.agentType,
      sport: this.sport,
      eventId: input.eventId,
      market: input.market,
      selection: input.selection,
      probability,
      fairOdds,
      marketOdds: selectionOdds,
      expectedValue: selectionOdds ? Number((probability * selectionOdds - 1).toFixed(4)) : null,
      confidence: 0.45,
      riskScore: 0.45,
      evidence,
      modelVersion: this.getModelVersion(),
      generatedAt: new Date().toISOString(),
      status: IntelligenceResultStatus.GENERATED,
      isMock: true,
    };
  }
}
