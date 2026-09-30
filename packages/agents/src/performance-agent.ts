import { BaseAgent, SideEffectLevel, type AgentDeclaration, type AgentRequest, type AgentResponse } from "@sport-os/agent-core";
import { toPerformanceRecordInput as aviatorToPerformanceRecordInput, type DoubleBetRecord, type DoubleBetSettlement } from "@sport-os/aviator-engine";
import { toPerformanceRecordInput as footballToPerformanceRecordInput, type TicketSettlement } from "@sport-os/football-engine";
import { Entitlement } from "@sport-os/platform";
import type { ISODateString } from "@sport-os/shared";
import { buildPerformanceLedgerEntry, computeLongestLosingStreak, computeMaxDrawdown, LedgerMode, type PerformanceLedgerEntry } from "@sport-os/settlement-engine";

/**
 * Performance Agent (Section 06 §4/30, extended Section 08 §39). Cross-
 * sport, read-only aggregation over already-settled records — "consume
 * historical results, calculate performance analytics, never rewrite
 * historical outcomes; never alter settlement outcomes; never fabricate
 * missing financial values." Unlike the Weekly Report Agent's football-
 * side gap (no stake/return amount existed anywhere before Section 08),
 * `DoubleBetRecord` genuinely DOES carry real `totalStake`/`totalReturn`/
 * `netPnl`/`roi` once both legs settle, and Section 08's real
 * `TicketSettlement` now does too — so both this agent's Aviator AND
 * football figures are real numbers, not `undefined` placeholders,
 * whenever settled records are supplied. Only SETTLED records contribute
 * to the money math; still-pending ones are counted but excluded, never
 * treated as a zero outcome.
 *
 * `computeMaxDrawdown`/`computeLongestLosingStreak` are
 * `@sport-os/settlement-engine`'s real, shared implementations (moved
 * there in Section 08 so football and Aviator performance share exactly
 * ONE algorithm) — this agent no longer keeps its own private copy.
 */

export interface PerformanceAgentInput {
  readonly periodStart: ISODateString;
  readonly periodEnd: ISODateString;
  readonly doubleBets: readonly DoubleBetRecord[];
  /** Section 08 addition — already-settled Aviator records (`@sport-os/aviator-engine/settlement.ts`'s `settleDoubleBet()` output), when the caller has them. Aggregated the SAME way as `doubleBets` below but through the shared, cross-sport `buildPerformanceLedgerEntry()`. */
  readonly doubleBetSettlements?: readonly DoubleBetSettlement[];
  /** Section 08 addition — already-settled football tickets (`@sport-os/football-engine/settlement.ts`'s `settleTicket()` output). */
  readonly footballSettlements?: readonly TicketSettlement[];
  /** Which ledger to aggregate football/Aviator settlements into — defaults to LIVE. Never mixes PAPER and LIVE in one entry (§22). */
  readonly ledgerMode?: LedgerMode;
}

export interface AviatorPerformanceSummary {
  readonly totalDoubleBets: number;
  readonly settledDoubleBets: number;
  readonly totalStaked: number | null;
  readonly totalReturned: number | null;
  readonly netPnl: number | null;
  readonly roi: number | null;
  readonly maxDrawdown: number | null;
  readonly longestLosingStreak: number | null;
}

export interface PerformanceAgentResult {
  readonly periodStart: ISODateString;
  readonly periodEnd: ISODateString;
  readonly aviator: AviatorPerformanceSummary;
  /** Real cross-sport `PerformanceLedgerEntry` for the supplied `doubleBetSettlements` (§23/§25) — `undefined` when none were supplied, never a fabricated empty entry. */
  readonly aviatorLedger: PerformanceLedgerEntry | undefined;
  /** Real `PerformanceLedgerEntry` for the supplied `footballSettlements` — `undefined` when none were supplied. */
  readonly footballLedger: PerformanceLedgerEntry | undefined;
  readonly generatedAt: ISODateString;
}

export const PERFORMANCE_AGENT_DECLARATION: AgentDeclaration = {
  agentId: "performance-agent",
  agentType: "performance",
  version: "0.1.0",
  capabilities: ["consume_historical_results", "calculate_performance_analytics"],
  requiredEntitlements: [Entitlement.ADVANCED_ANALYTICS],
  allowedInputs: ["REQUEST_PERFORMANCE_REPORT"],
  allowedOutputs: [],
  dependencies: [],
  sideEffectLevel: SideEffectLevel.ANALYSIS,
};

export class PerformanceAgent extends BaseAgent<PerformanceAgentInput, PerformanceAgentResult> {
  constructor(agentId: string = PERFORMANCE_AGENT_DECLARATION.agentId) {
    super({ agentId, agentType: PERFORMANCE_AGENT_DECLARATION.agentType, name: "Performance Agent", version: PERFORMANCE_AGENT_DECLARATION.version, capabilities: PERFORMANCE_AGENT_DECLARATION.capabilities });
  }

  async execute(request: AgentRequest<PerformanceAgentInput>): Promise<AgentResponse<PerformanceAgentResult>> {
    const { input } = request;
    const settled = input.doubleBets.filter((bet) => bet.totalReturn !== undefined && bet.netPnl !== undefined);

    const totalStaked = settled.length > 0 ? settled.reduce((sum, bet) => sum + bet.totalStake, 0) : null;
    const totalReturned = settled.length > 0 ? settled.reduce((sum, bet) => sum + (bet.totalReturn ?? 0), 0) : null;
    const netPnl = settled.length > 0 ? settled.reduce((sum, bet) => sum + (bet.netPnl ?? 0), 0) : null;
    const roi = totalStaked !== null && totalStaked > 0 && netPnl !== null ? netPnl / totalStaked : null;

    const pnls = settled.map((bet) => bet.netPnl ?? 0);
    const aviator: AviatorPerformanceSummary = {
      totalDoubleBets: input.doubleBets.length,
      settledDoubleBets: settled.length,
      totalStaked,
      totalReturned,
      netPnl,
      roi,
      maxDrawdown: computeMaxDrawdown(pnls),
      longestLosingStreak: computeLongestLosingStreak(pnls),
    };

    const ledgerMode = input.ledgerMode ?? LedgerMode.LIVE;

    const aviatorLedger =
      input.doubleBetSettlements && input.doubleBetSettlements.length > 0
        ? buildPerformanceLedgerEntry({
            records: input.doubleBetSettlements.map((s) => aviatorToPerformanceRecordInput(s)),
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            ledgerMode,
            sport: "aviator",
          })
        : undefined;

    const footballLedger =
      input.footballSettlements && input.footballSettlements.length > 0
        ? buildPerformanceLedgerEntry({
            records: input.footballSettlements.map((s) => footballToPerformanceRecordInput(s)),
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            ledgerMode,
            sport: "football",
          })
        : undefined;

    const result: PerformanceAgentResult = { periodStart: input.periodStart, periodEnd: input.periodEnd, aviator, aviatorLedger, footballLedger, generatedAt: new Date().toISOString() };
    return { requestId: request.requestId, output: result, completedAt: new Date().toISOString() };
  }
}
