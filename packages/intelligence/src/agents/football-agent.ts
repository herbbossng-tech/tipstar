import { generateId } from "@tipstar/shared";
import { AgentType, IntelligenceResultStatus, Sport, type EvidenceItem, type IntelligenceResult } from "@tipstar/types";
import type { FootballProvider } from "@tipstar/sports";
import { BaseIntelligenceAgent } from "../base-agent.js";
import type { IntelligenceAgentInput } from "../agent.js";

const MODEL_VERSION = "football-agent@0.1.0-dev";

/**
 * Football Agent boundary (Section 10). Real market/feature logic (xG,
 * form, injuries, fixture congestion, etc.) is out of scope for Section 01
 * — this establishes the agent's place in the architecture and its data
 * dependency on FootballProvider.
 */
export class FootballAgent extends BaseIntelligenceAgent {
  readonly agentType = AgentType.FOOTBALL;
  readonly sport = Sport.FOOTBALL;

  constructor(
    private readonly provider: FootballProvider,
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
      { label: "fixture_status", value: event.status, sourceType: "provider_data", sourceRef: this.provider.providerId },
    ];

    const probability = 0.45; // fixed dev-only placeholder, never a real prediction
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
      confidence: 0.4,
      riskScore: 0.5,
      evidence,
      modelVersion: this.getModelVersion(),
      generatedAt: new Date().toISOString(),
      status: IntelligenceResultStatus.GENERATED,
      isMock: true,
    };
  }
}
