import { BaseAgent, SideEffectLevel, type AgentDeclaration, type AgentRequest, type AgentResponse } from "@sport-os/agent-core";
import type { AviatorSignal } from "@sport-os/aviator-engine";
import { Entitlement } from "@sport-os/platform";
import type { GlobalDailyRiskController, RiskControllerState } from "@sport-os/risk-engine";
import type { ISODateString } from "@sport-os/shared";

/**
 * Aviator Risk Agent (Section 06 §15). "It must respect GLOBAL DAILY
 * RISK CONTROLLER... Risk state is global for the day. It must not
 * create a second independent daily ledger." This agent is constructed
 * with a SHARED `GlobalDailyRiskController` instance (the caller's one,
 * process-wide instance — see docs/agents/AGENT_CORE.md) and only ever
 * reads its state; it never constructs its own controller, and it never
 * calls `recordResult()` either (recording a settled outcome belongs to
 * whichever code actually observes that outcome — the Settlement/
 * Performance path — not this eligibility check).
 */

export interface AviatorRiskAgentInput {
  readonly signal: AviatorSignal;
}

export interface AviatorRiskDecision {
  readonly executionAllowed: boolean;
  /** Set only when executionAllowed is false — DAILY_TARGET_REACHED or DAILY_STOP_LOSS_REACHED, mirroring RiskControllerState exactly (never a paraphrase). */
  readonly reason: RiskControllerState | undefined;
  readonly cumulativePnL: number;
  readonly evaluatedAt: ISODateString;
}

export interface AviatorRiskAgentDependencies {
  readonly riskController: GlobalDailyRiskController;
}

export const AVIATOR_RISK_AGENT_DECLARATION: AgentDeclaration = {
  agentId: "aviator-risk-agent",
  agentType: "aviator_risk",
  version: "0.1.0",
  capabilities: ["consume_signal_and_risk_state", "determine_risk_eligibility"],
  requiredEntitlements: [Entitlement.AVIATOR_ANALYSIS],
  allowedInputs: ["REQUEST_AVIATOR_RISK_CHECK"],
  allowedOutputs: ["RISK_LIMIT_REACHED"],
  dependencies: ["aviator_intelligence"],
  sideEffectLevel: SideEffectLevel.ANALYSIS,
};

export class AviatorRiskAgent extends BaseAgent<AviatorRiskAgentInput, AviatorRiskDecision> {
  constructor(
    private readonly deps: AviatorRiskAgentDependencies,
    agentId: string = AVIATOR_RISK_AGENT_DECLARATION.agentId,
  ) {
    super({ agentId, agentType: AVIATOR_RISK_AGENT_DECLARATION.agentType, name: "Aviator Risk Agent", version: AVIATOR_RISK_AGENT_DECLARATION.version, capabilities: AVIATOR_RISK_AGENT_DECLARATION.capabilities });
  }

  async execute(request: AgentRequest<AviatorRiskAgentInput>): Promise<AgentResponse<AviatorRiskDecision>> {
    const state = this.deps.riskController.getState();
    const allowed = this.deps.riskController.isExecutionAllowed();
    const decision: AviatorRiskDecision = {
      executionAllowed: allowed,
      reason: allowed ? undefined : state,
      cumulativePnL: this.deps.riskController.getCumulativePnL(),
      evaluatedAt: new Date().toISOString(),
    };
    return { requestId: request.requestId, output: decision, completedAt: new Date().toISOString() };
  }
}
