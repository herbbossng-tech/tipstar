import { BaseAgent, SideEffectLevel, type AgentDeclaration, type AgentRequest, type AgentResponse } from "@sport-os/agent-core";
import { buildDefaultDoubleBetLegs, type AviatorSignal, type DoubleBetRecord } from "@sport-os/aviator-engine";
import { Entitlement } from "@sport-os/platform";
import { generateId, ValidationError, type ISODateString } from "@sport-os/shared";
import type { ExecutionIntegration } from "../execution-integration.js";
import type { AviatorRiskDecision } from "./risk-agent.js";

/**
 * Aviator Automation Agent (Section 06 §16). Mirrors the Football
 * Automation Agent's structure (MANUAL/ASSISTED/AUTOMATIC, typed
 * `ExecutionIntegration` boundary, never a fabricated execution) with
 * one addition: it is the one place `@sport-os/aviator-engine`'s locked
 * Double Bet model (`buildDefaultDoubleBetLegs`) is actually used to
 * construct a real `DoubleBetRecord` before requesting execution of
 * each leg — "Default split 50/50. No Martingale by default. Do not
 * allow an agent to silently change this": `execute()` never overrides
 * `target1StakeWeight`, so every double bet this agent places is exactly
 * 50/50 unless the caller's OWN input explicitly asks for something else
 * (nothing in this codebase does).
 *
 * The risk decision is REQUIRED input, not re-derived here — "must not
 * create a second independent daily ledger" (§15's rule extends to this
 * agent too): if `riskDecision.executionAllowed` is false, this agent
 * refuses regardless of `executionMode`, before ever touching
 * `ExecutionIntegration`.
 */

export const AviatorExecutionMode = { MANUAL: "manual", ASSISTED: "assisted", AUTOMATIC: "automatic" } as const;
export type AviatorExecutionMode = (typeof AviatorExecutionMode)[keyof typeof AviatorExecutionMode];

export const AviatorAutomationOutcome = {
  EXECUTED: "executed",
  MANUAL_REQUIRED: "manual_required",
  CONFIRMATION_REQUIRED: "confirmation_required",
  NOT_AVAILABLE: "not_available",
  RISK_BLOCKED: "risk_blocked",
} as const;
export type AviatorAutomationOutcome = (typeof AviatorAutomationOutcome)[keyof typeof AviatorAutomationOutcome];

export interface AviatorAutomationAgentInput {
  readonly signal: AviatorSignal;
  readonly riskDecision: AviatorRiskDecision;
  readonly executionMode: AviatorExecutionMode;
  readonly totalStake: number;
  readonly target1Multiplier: number;
  readonly target2Multiplier: number;
  readonly idempotencyKey: string;
  readonly userConfirmed: boolean;
}

export interface AviatorAutomationResult {
  readonly outcome: AviatorAutomationOutcome;
  readonly doubleBet: DoubleBetRecord | undefined;
  readonly reason: string;
  readonly completedAt: ISODateString;
}

export interface AviatorAutomationAgentDependencies {
  readonly integration: ExecutionIntegration;
}

export const AVIATOR_AUTOMATION_AGENT_DECLARATION: AgentDeclaration = {
  agentId: "aviator-automation-agent",
  agentType: "aviator_automation",
  version: "0.1.0",
  capabilities: ["request_permitted_execution", "respect_execution_mode", "double_bet_placement"],
  requiredEntitlements: [Entitlement.AVIATOR_AUTOMATION],
  allowedInputs: ["REQUEST_EXECUTION"],
  allowedOutputs: ["AVIATOR_EXECUTION_COMPLETED"],
  dependencies: ["aviator_risk"],
  sideEffectLevel: SideEffectLevel.EXECUTION,
};

export class AviatorAutomationAgent extends BaseAgent<AviatorAutomationAgentInput, AviatorAutomationResult> {
  constructor(
    private readonly deps: AviatorAutomationAgentDependencies,
    agentId: string = AVIATOR_AUTOMATION_AGENT_DECLARATION.agentId,
  ) {
    super({ agentId, agentType: AVIATOR_AUTOMATION_AGENT_DECLARATION.agentType, name: "Aviator Automation Agent", version: AVIATOR_AUTOMATION_AGENT_DECLARATION.version, capabilities: AVIATOR_AUTOMATION_AGENT_DECLARATION.capabilities });
  }

  async execute(request: AgentRequest<AviatorAutomationAgentInput>): Promise<AgentResponse<AviatorAutomationResult>> {
    const { input } = request;
    if (input.totalStake <= 0) {
      throw new ValidationError({ message: "totalStake must be a positive number.", code: "AVIATOR_AUTOMATION_INVALID_STAKE", context: { totalStake: input.totalStake } });
    }

    const result = await this.decide(input);
    return { requestId: request.requestId, output: result, completedAt: new Date().toISOString() };
  }

  private async decide(input: AviatorAutomationAgentInput): Promise<AviatorAutomationResult> {
    const now = new Date().toISOString();

    if (!input.riskDecision.executionAllowed) {
      return { outcome: AviatorAutomationOutcome.RISK_BLOCKED, doubleBet: undefined, reason: `GlobalDailyRiskController disallows execution: ${input.riskDecision.reason}.`, completedAt: now };
    }

    if (input.executionMode === AviatorExecutionMode.MANUAL) {
      return { outcome: AviatorAutomationOutcome.MANUAL_REQUIRED, doubleBet: undefined, reason: "Execution mode is MANUAL — the user places this double bet themselves.", completedAt: now };
    }

    if (input.executionMode === AviatorExecutionMode.ASSISTED && !input.userConfirmed) {
      return { outcome: AviatorAutomationOutcome.CONFIRMATION_REQUIRED, doubleBet: undefined, reason: "ASSISTED execution requires explicit user confirmation before requesting execution.", completedAt: now };
    }

    const available = await this.deps.integration.isAvailable();
    if (!available) {
      return { outcome: AviatorAutomationOutcome.NOT_AVAILABLE, doubleBet: undefined, reason: "No permitted execution integration is currently available.", completedAt: now };
    }

    // Locked 50/50 split — target1StakeWeight is never overridden here.
    const { target1, target2 } = buildDefaultDoubleBetLegs({ totalStake: input.totalStake, target1Multiplier: input.target1Multiplier, target2Multiplier: input.target2Multiplier });
    await this.deps.integration.execute({ ticketOrSignalId: input.signal.signalId, stake: target1.stake, idempotencyKey: `${input.idempotencyKey}:target1` });
    await this.deps.integration.execute({ ticketOrSignalId: input.signal.signalId, stake: target2.stake, idempotencyKey: `${input.idempotencyKey}:target2` });

    const doubleBet: DoubleBetRecord = {
      doubleBetId: generateId(),
      signalId: input.signal.signalId,
      roundId: input.signal.signalId,
      target1,
      target2,
      totalStake: target1.stake + target2.stake,
      totalReturn: undefined,
      netPnl: undefined,
      roi: undefined,
      createdAt: now,
    };
    return { outcome: AviatorAutomationOutcome.EXECUTED, doubleBet, reason: "Both legs submitted to the permitted execution integration.", completedAt: now };
  }
}
