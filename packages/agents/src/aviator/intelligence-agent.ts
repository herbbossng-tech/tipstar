import { BaseAgent, SideEffectLevel, type AgentDeclaration, type AgentRequest, type AgentResponse } from "@sport-os/agent-core";
import type { AviatorSignal, AviatorSignalEngine } from "@sport-os/aviator-engine";
import { Entitlement } from "@sport-os/platform";
import type { ISODateString } from "@sport-os/shared";

/**
 * Aviator Intelligence Agent (Section 06 §14). Wraps
 * `AviatorSignalEngine` — computes no signal logic itself. "Allowed
 * signal states: BUY, SELL, WAIT, NO TRADE, MONITOR... Do not claim
 * guaranteed prediction. Do not manufacture historical observations."
 * `signal` is `undefined` exactly when the engine reports no signal at
 * all (distinct from a real WAIT/NO_TRADE/MONITOR state, which IS a
 * signal — just one that says "don't trade right now").
 */

export interface AviatorIntelligenceAgentInput {
  readonly methodologyVersion: string;
}

export interface AviatorIntelligenceResult {
  readonly signal: AviatorSignal | undefined;
  readonly methodologyVersion: string;
  readonly generatedAt: ISODateString;
}

export interface AviatorIntelligenceAgentDependencies {
  readonly signalEngine: AviatorSignalEngine;
}

export const AVIATOR_INTELLIGENCE_AGENT_DECLARATION: AgentDeclaration = {
  agentId: "aviator-intelligence-agent",
  agentType: "aviator_intelligence",
  version: "0.1.0",
  capabilities: ["consume_aviator_observations", "generate_structured_signal", "expose_data_quality", "expose_methodology_version"],
  requiredEntitlements: [Entitlement.AVIATOR_ANALYSIS],
  allowedInputs: ["REQUEST_AVIATOR_SIGNAL"],
  allowedOutputs: ["AVIATOR_SIGNAL_GENERATED"],
  dependencies: [],
  sideEffectLevel: SideEffectLevel.ANALYSIS,
};

export class AviatorIntelligenceAgent extends BaseAgent<AviatorIntelligenceAgentInput, AviatorIntelligenceResult> {
  constructor(
    private readonly deps: AviatorIntelligenceAgentDependencies,
    agentId: string = AVIATOR_INTELLIGENCE_AGENT_DECLARATION.agentId,
  ) {
    super({ agentId, agentType: AVIATOR_INTELLIGENCE_AGENT_DECLARATION.agentType, name: "Aviator Intelligence Agent", version: AVIATOR_INTELLIGENCE_AGENT_DECLARATION.version, capabilities: AVIATOR_INTELLIGENCE_AGENT_DECLARATION.capabilities });
  }

  async execute(request: AgentRequest<AviatorIntelligenceAgentInput>): Promise<AgentResponse<AviatorIntelligenceResult>> {
    const signal = await this.deps.signalEngine.generateSignal();
    const result: AviatorIntelligenceResult = { signal, methodologyVersion: request.input.methodologyVersion, generatedAt: new Date().toISOString() };
    return { requestId: request.requestId, output: result, completedAt: new Date().toISOString() };
  }
}
