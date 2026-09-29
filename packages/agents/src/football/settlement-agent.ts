import { BaseAgent, SideEffectLevel, type AgentDeclaration, type AgentRequest, type AgentResponse } from "@sport-os/agent-core";
import type { ExecutedWager, MatchResult, Settlement, SettlementService, Ticket } from "@sport-os/settlement-engine";

/**
 * Settlement Agent (Section 06 §12). Thin orchestration over
 * `@sport-os/settlement-engine`'s `SettlementService` — this agent
 * computes NO settlement math itself (leg/ticket outcome determination
 * is `SettlementService.settle()`'s job, a later-section concern that is
 * `NotImplementedSettlementService` today; §38 explicitly excludes
 * "settlement calculations beyond the agent contract boundary" from
 * Section 06). What this agent DOES own: never mutating the original
 * ticket/prediction it receives, and packaging the result as a typed
 * output rather than a bare `Settlement` value with no provenance.
 *
 * "A 5-leg accumulator that loses is 1 LOST TICKET, not 5 LOST TICKETS"
 * — enforced upstream by `settlement-engine/rules.ts`'s `countTickets`/
 * `isAccumulator`, unchanged by this agent (it settles exactly the one
 * `Ticket` it's given, however many legs it holds).
 */

export interface SettlementAgentInput {
  readonly ticket: Ticket;
  readonly executedWager: ExecutedWager;
  /** The official result the caller resolved for this ticket — this agent does not fetch it itself (see module doc comment). */
  readonly officialResult: MatchResult;
}

export interface SettlementAgentResult {
  readonly settlement: Settlement;
  /** Passed through byte-for-byte from the input — proof (checked by this agent's tests) that settling never rewrites the original ticket. */
  readonly originalTicket: Ticket;
}

export interface SettlementAgentDependencies {
  readonly settlementService: SettlementService;
}

export const SETTLEMENT_AGENT_DECLARATION: AgentDeclaration = {
  agentId: "settlement-agent",
  agentType: "settlement",
  version: "0.1.0",
  capabilities: ["consume_executed_ticket", "process_official_result", "calculate_ticket_outcome", "emit_settlement_event"],
  // Settlement is an internal backend process triggered by an official
  // result becoming available, not a user-facing analysis/automation
  // feature — none of @sport-os/platform's named Entitlements gate it.
  requiredEntitlements: [],
  allowedInputs: ["REQUEST_SETTLEMENT"],
  allowedOutputs: ["TICKET_SETTLED"],
  dependencies: [],
  // Settlement is a REQUESTED_ACTION, not raw analysis: it asks the (gated) SettlementService to produce a durable financial record.
  sideEffectLevel: SideEffectLevel.REQUESTED_ACTION,
};

export class SettlementAgent extends BaseAgent<SettlementAgentInput, SettlementAgentResult> {
  constructor(
    private readonly deps: SettlementAgentDependencies,
    agentId: string = SETTLEMENT_AGENT_DECLARATION.agentId,
  ) {
    super({ agentId, agentType: SETTLEMENT_AGENT_DECLARATION.agentType, name: "Settlement Agent", version: SETTLEMENT_AGENT_DECLARATION.version, capabilities: SETTLEMENT_AGENT_DECLARATION.capabilities });
  }

  async execute(request: AgentRequest<SettlementAgentInput>): Promise<AgentResponse<SettlementAgentResult>> {
    const { input } = request;
    // A defensive, structural copy — even though nothing below mutates
    // `input.ticket`, this guarantees it by construction rather than by
    // convention: `originalTicket` in the response can never alias
    // anything this method (or a future change to it) touches.
    const originalTicket: Ticket = { ticketId: input.ticket.ticketId, selections: [...input.ticket.selections], publishedAt: input.ticket.publishedAt };

    const settlement = await this.deps.settlementService.settle(input.ticket.ticketId, input.officialResult);

    return { requestId: request.requestId, output: { settlement, originalTicket }, completedAt: new Date().toISOString() };
  }
}
