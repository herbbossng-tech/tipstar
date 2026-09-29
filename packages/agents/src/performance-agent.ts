import { BaseAgent, SideEffectLevel, type AgentDeclaration, type AgentRequest, type AgentResponse } from "@sport-os/agent-core";
import type { DoubleBetRecord } from "@sport-os/aviator-engine";
import { Entitlement } from "@sport-os/platform";
import type { ISODateString } from "@sport-os/shared";

/**
 * Performance Agent (Section 06 §4/30). Cross-sport, read-only
 * aggregation over already-settled records — "consume historical
 * results, calculate performance analytics, never rewrite historical
 * outcomes." Unlike the Weekly Report Agent's football-side gap (no
 * stake/return amount exists anywhere in `@sport-os/settlement-engine`
 * yet), `DoubleBetRecord` genuinely DOES carry real `totalStake`/
 * `totalReturn`/`netPnl`/`roi` once both legs settle — so this agent's
 * Aviator-side P&L figures are real numbers, not `undefined`
 * placeholders, whenever settled records are supplied. Only SETTLED
 * records (both legs resolved, `totalReturn !== undefined`) contribute
 * to the aggregate; still-open double bets are counted but excluded
 * from the money math, never treated as a zero outcome.
 */

export interface PerformanceAgentInput {
  readonly periodStart: ISODateString;
  readonly periodEnd: ISODateString;
  readonly doubleBets: readonly DoubleBetRecord[];
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

/** Chronological equity-curve drawdown: the largest peak-to-trough drop in cumulative P&L, in the ORDER settled records are supplied (callers must pass them in real settlement order — this function does not itself know a real timestamp order to sort by beyond what's given). */
function computeMaxDrawdown(pnls: readonly number[]): number | null {
  if (pnls.length === 0) return null;
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const pnl of pnls) {
    cumulative += pnl;
    peak = Math.max(peak, cumulative);
    maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
  }
  return maxDrawdown;
}

function computeLongestLosingStreak(pnls: readonly number[]): number | null {
  if (pnls.length === 0) return null;
  let longest = 0;
  let current = 0;
  for (const pnl of pnls) {
    if (pnl < 0) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

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

    const result: PerformanceAgentResult = { periodStart: input.periodStart, periodEnd: input.periodEnd, aviator, generatedAt: new Date().toISOString() };
    return { requestId: request.requestId, output: result, completedAt: new Date().toISOString() };
  }
}
