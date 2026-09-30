import { BaseAgent, SideEffectLevel, type AgentDeclaration, type AgentRequest, type AgentResponse } from "@sport-os/agent-core";
import { settleTicket, type FootballExecutionAccounting, type FootballResultSnapshot, type TicketRecord, type TicketSettlement } from "@sport-os/football-engine";
import { LedgerMode, type ExecutedWager, type MatchResult, type Settlement, type SettlementService, type Ticket } from "@sport-os/settlement-engine";
import { ValidationError, type UUID } from "@sport-os/shared";

/**
 * Settlement Agent (Section 06 §12, extended Section 08 §38). Thin
 * orchestration — REQUEST → Settlement Engine → Settlement Result — this
 * agent computes NO settlement math itself in either path below.
 *
 * Two input shapes, both real:
 * - LEGACY (`ticket`/`executedWager`/`officialResult`, Section 06):
 *   delegates to the injected `SettlementService` — still exactly the
 *   same contract, unchanged; `NotImplementedSettlementService` remains
 *   the default for any caller that hasn't migrated.
 * - REAL (`richTicket`, Section 08): calls `@sport-os/football-engine`'s
 *   real `settleTicket()` directly — the actual market-grading + §13
 *   accumulator-aggregation + §17 financial-accounting engine, never
 *   duplicated here. `richTicket` takes precedence when both are
 *   supplied.
 *
 * What this agent DOES own either way: never mutating the original
 * ticket/prediction it receives, and packaging the result as a typed
 * output (`richSettlement`, directly consumable by
 * `@sport-os/football-engine`'s `toPerformanceRecordInput()` /
 * `@sport-os/settlement-engine`'s `buildPerformanceLedgerEntry()` — the
 * "→ Performance Ledger" half of §38's flow) rather than a bare
 * `Settlement` value with no provenance.
 *
 * "A 5-leg accumulator that loses is 1 LOST TICKET, not 5 LOST TICKETS"
 * — enforced upstream, unchanged by this agent (it settles exactly the
 * one ticket it's given, however many legs it holds).
 */

export interface SettlementAgentInput {
  /** Legacy path (Section 06) — required together with `officialResult` when `richTicket` is absent. */
  readonly ticket?: Ticket;
  readonly executedWager?: ExecutedWager;
  readonly officialResult?: MatchResult;

  /** Section 08 real path — takes precedence over the legacy fields when present. */
  readonly richTicket?: TicketRecord;
  readonly footballResults?: ReadonlyMap<UUID, FootballResultSnapshot>;
  readonly execution?: FootballExecutionAccounting;
  readonly ledgerMode?: LedgerMode;
}

export interface SettlementAgentResult {
  readonly settlement: Settlement;
  /** Passed through byte-for-byte from the input's legacy `ticket` — proof (checked by this agent's tests) that settling never rewrites the original ticket. `undefined` on the Section 08 real path (there is no legacy `Ticket` to echo). */
  readonly originalTicket: Ticket | undefined;
  /** The full Section 08 settlement record (per-leg detail, financial accounting) — `undefined` on the legacy path. */
  readonly richSettlement: TicketSettlement | undefined;
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

    if (input.richTicket) {
      const richSettlement = settleTicket({
        ticket: input.richTicket,
        results: input.footballResults ?? new Map(),
        execution: input.execution,
        ledgerMode: input.ledgerMode ?? LedgerMode.LIVE,
        source: this.agentId,
        correlationId: request.requestId,
        now: new Date().toISOString(),
      });
      const settlement: Settlement = { settlementId: richSettlement.settlementId, ticketId: richSettlement.ticketId, status: richSettlement.status, settledAt: richSettlement.settledAt };
      return { requestId: request.requestId, output: { settlement, originalTicket: undefined, richSettlement }, completedAt: new Date().toISOString() };
    }

    if (!input.ticket || !input.officialResult) {
      throw new ValidationError({ message: "SettlementAgent requires either richTicket (Section 08) or ticket + officialResult (legacy).", code: "SETTLEMENT_AGENT_MISSING_INPUT" });
    }

    // A defensive, structural copy — even though nothing below mutates
    // `input.ticket`, this guarantees it by construction rather than by
    // convention: `originalTicket` in the response can never alias
    // anything this method (or a future change to it) touches.
    const originalTicket: Ticket = { ticketId: input.ticket.ticketId, selections: [...input.ticket.selections], publishedAt: input.ticket.publishedAt };

    const settlement = await this.deps.settlementService.settle(input.ticket.ticketId, input.officialResult);

    return { requestId: request.requestId, output: { settlement, originalTicket, richSettlement: undefined }, completedAt: new Date().toISOString() };
  }
}
