import { BaseAgent, SideEffectLevel, type AgentDeclaration, type AgentRequest, type AgentResponse } from "@sport-os/agent-core";
import { Entitlement } from "@sport-os/platform";
import { ValidationError, type ISODateString, type UUID } from "@sport-os/shared";
import type { ExecutedWager, Ticket } from "@sport-os/settlement-engine";
import type { ExecutionIntegration } from "../execution-integration.js";

/**
 * Football Automation Agent (Section 06 §10). Orchestrates AUTHORIZED
 * automation only — the required GlobalExecutionGate authorization
 * happens in `AgentOrchestrator.dispatch()` BEFORE this agent's
 * `execute()` is ever called (this agent's declared `sideEffectLevel` is
 * EXECUTION, so the orchestrator refuses to dispatch to it without a
 * passing `ExecutionAuthorizer.authorize()` call first). This agent
 * itself never checks license/entitlement/risk — it only decides,
 * within an already-authorized invocation, whether a permitted
 * integration actually exists and whether the human-confirmation
 * boundary (§24) has genuinely been satisfied.
 *
 * "Must NOT: bypass authentication, bypass CAPTCHA, bypass anti-bot
 * controls, scrape around bookmaker security, invent an API, execute
 * without authorization, place a wager when execution mode requires
 * user confirmation." No such bypass code exists here — this agent
 * only ever calls the one typed `ExecutionIntegration` boundary
 * (`execution-integration.ts`), whose only real implementation always
 * reports itself unavailable.
 */

export const FootballExecutionMode = { MANUAL: "manual", ASSISTED: "assisted", AUTOMATIC: "automatic" } as const;
export type FootballExecutionMode = (typeof FootballExecutionMode)[keyof typeof FootballExecutionMode];

export const FootballAutomationOutcome = {
  EXECUTED: "executed",
  MANUAL_REQUIRED: "manual_required",
  CONFIRMATION_REQUIRED: "confirmation_required",
  NOT_AVAILABLE: "not_available",
} as const;
export type FootballAutomationOutcome = (typeof FootballAutomationOutcome)[keyof typeof FootballAutomationOutcome];

export interface FootballAutomationAgentInput {
  readonly ticket: Ticket;
  readonly executionMode: FootballExecutionMode;
  readonly stake: number;
  readonly idempotencyKey: string;
  /**
   * Must be `true` only when the caller genuinely obtained an explicit
   * user confirmation action for THIS ticket (§24: "do not infer
   * confirmation from merely opening a screen or viewing a message") —
   * this agent trusts the flag at face value; obtaining it honestly is
   * the caller's (Mini App/bot) responsibility, out of this agent's
   * reach entirely.
   */
  readonly userConfirmed: boolean;
}

export interface FootballAutomationResult {
  readonly outcome: FootballAutomationOutcome;
  readonly ticketId: UUID;
  readonly executedWager: ExecutedWager | undefined;
  readonly reason: string;
  readonly completedAt: ISODateString;
}

export interface FootballAutomationAgentDependencies {
  readonly integration: ExecutionIntegration;
}

export const FOOTBALL_AUTOMATION_AGENT_DECLARATION: AgentDeclaration = {
  agentId: "football-automation-agent",
  agentType: "football_automation",
  version: "0.1.0",
  capabilities: ["consume_finalized_ticket", "request_execution", "receive_execution_result"],
  requiredEntitlements: [Entitlement.FOOTBALL_AUTOMATION],
  allowedInputs: ["REQUEST_EXECUTION"],
  allowedOutputs: ["TICKET_EXECUTED"],
  dependencies: [],
  sideEffectLevel: SideEffectLevel.EXECUTION,
};

export class FootballAutomationAgent extends BaseAgent<FootballAutomationAgentInput, FootballAutomationResult> {
  constructor(
    private readonly deps: FootballAutomationAgentDependencies,
    agentId: string = FOOTBALL_AUTOMATION_AGENT_DECLARATION.agentId,
  ) {
    super({ agentId, agentType: FOOTBALL_AUTOMATION_AGENT_DECLARATION.agentType, name: "Football Automation Agent", version: FOOTBALL_AUTOMATION_AGENT_DECLARATION.version, capabilities: FOOTBALL_AUTOMATION_AGENT_DECLARATION.capabilities });
  }

  async execute(request: AgentRequest<FootballAutomationAgentInput>): Promise<AgentResponse<FootballAutomationResult>> {
    const { input } = request;
    if (input.stake <= 0) {
      throw new ValidationError({ message: "stake must be a positive number.", code: "FOOTBALL_AUTOMATION_INVALID_STAKE", context: { stake: input.stake } });
    }

    const result = await this.decide(input);
    return { requestId: request.requestId, output: result, completedAt: new Date().toISOString() };
  }

  private async decide(input: FootballAutomationAgentInput): Promise<FootballAutomationResult> {
    const now = new Date().toISOString();

    if (input.executionMode === FootballExecutionMode.MANUAL) {
      return { outcome: FootballAutomationOutcome.MANUAL_REQUIRED, ticketId: input.ticket.ticketId, executedWager: undefined, reason: "Execution mode is MANUAL — the user places this wager themselves.", completedAt: now };
    }

    if (input.executionMode === FootballExecutionMode.ASSISTED && !input.userConfirmed) {
      return { outcome: FootballAutomationOutcome.CONFIRMATION_REQUIRED, ticketId: input.ticket.ticketId, executedWager: undefined, reason: "ASSISTED execution requires explicit user confirmation before requesting execution.", completedAt: now };
    }

    const available = await this.deps.integration.isAvailable();
    if (!available) {
      return { outcome: FootballAutomationOutcome.NOT_AVAILABLE, ticketId: input.ticket.ticketId, executedWager: undefined, reason: "No permitted bookmaker integration is currently available.", completedAt: now };
    }

    const executionResult = await this.deps.integration.execute({ ticketOrSignalId: input.ticket.ticketId, stake: input.stake, idempotencyKey: input.idempotencyKey });
    const executedWager: ExecutedWager = { ticketId: input.ticket.ticketId, stake: executionResult.stake, executedAt: executionResult.executedAt };
    return { outcome: FootballAutomationOutcome.EXECUTED, ticketId: input.ticket.ticketId, executedWager, reason: "Execution request completed by the permitted integration.", completedAt: now };
  }
}
