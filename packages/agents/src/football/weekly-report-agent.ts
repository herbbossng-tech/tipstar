import { BaseAgent, SideEffectLevel, type AgentDeclaration, type AgentRequest, type AgentResponse } from "@sport-os/agent-core";
import { Entitlement } from "@sport-os/platform";
import type { ISODateString } from "@sport-os/shared";
import { SettlementStatus, type Settlement } from "@sport-os/settlement-engine";

/**
 * Weekly Report Agent (Section 06 §13). Pure, deterministic aggregation
 * over caller-supplied, already-settled `Settlement[]` — the same
 * "arithmetic control-flow over caller-supplied data, not a prediction
 * or fabricated-data source" precedent Section 01 used to justify
 * `GlobalDailyRiskController` being real rather than stubbed. This
 * agent computes NOTHING about whether a ticket won or lost (that's
 * `SettlementService`'s job, upstream); it only counts and rate-derives
 * over `Settlement.status`.
 *
 * "Must distinguish PREDICTION PERFORMANCE from EXECUTED WAGER
 * PERFORMANCE. Do not report simulated ROI as real-world P&L. Do not
 * invent stake or return." `@sport-os/settlement-engine`'s `Settlement`
 * type carries WON/LOST/VOID/PUSH/PENDING/CANCELLED status but no
 * stake/payout amount anywhere yet — see
 * docs/architecture/OPEN_QUESTIONS.md's open question on this gap. Real
 * monetary P&L/ROI/drawdown/losing-streak reporting is therefore
 * genuinely impossible from what this codebase can query today, so
 * `executedWagerPerformance` below is `undefined` — never a fabricated
 * number standing in for missing data.
 */

export interface TicketCounts {
  readonly total: number;
  readonly won: number;
  readonly lost: number;
  readonly voided: number;
  readonly pushed: number;
  readonly pending: number;
  readonly cancelled: number;
}

export interface WeeklyReportAgentInput {
  readonly periodStart: ISODateString;
  readonly periodEnd: ISODateString;
  readonly settlements: readonly Settlement[];
}

export interface WeeklyReportResult {
  readonly periodStart: ISODateString;
  readonly periodEnd: ISODateString;
  readonly ticketCounts: TicketCounts;
  /** Win rate over SETTLED (WON/LOST) tickets only — VOID/PUSH/PENDING/CANCELLED are correctly excluded from the denominator, never counted as a loss. `null` when there are zero settled tickets in the period (never fabricated as 0). */
  readonly predictionWinRate: number | null;
  /** Always undefined today — see module doc comment: no stake/payout amount exists anywhere in this codebase's settlement data yet. Kept as an explicit field (not omitted) so a future section that adds real amounts has an obvious place to populate it without a shape change. */
  readonly executedWagerPerformance: undefined;
  readonly generatedAt: ISODateString;
}

export const WEEKLY_REPORT_AGENT_DECLARATION: AgentDeclaration = {
  agentId: "weekly-report-agent",
  agentType: "weekly_report",
  version: "0.1.0",
  capabilities: ["consume_settled_data", "generate_report"],
  requiredEntitlements: [Entitlement.WEEKLY_REPORTS],
  allowedInputs: ["REQUEST_WEEKLY_REPORT"],
  allowedOutputs: ["WEEKLY_REPORT_GENERATED"],
  dependencies: ["settlement"],
  sideEffectLevel: SideEffectLevel.ANALYSIS,
};

function countTicketsByStatus(settlements: readonly Settlement[]): TicketCounts {
  const counts: TicketCounts = { total: settlements.length, won: 0, lost: 0, voided: 0, pushed: 0, pending: 0, cancelled: 0 };
  const mutable = { ...counts };
  for (const settlement of settlements) {
    switch (settlement.status) {
      case SettlementStatus.WON:
        mutable.won += 1;
        break;
      case SettlementStatus.LOST:
        mutable.lost += 1;
        break;
      case SettlementStatus.VOID:
        mutable.voided += 1;
        break;
      case SettlementStatus.PUSH:
        mutable.pushed += 1;
        break;
      case SettlementStatus.PENDING:
        mutable.pending += 1;
        break;
      case SettlementStatus.CANCELLED:
        mutable.cancelled += 1;
        break;
    }
  }
  return mutable;
}

export class WeeklyReportAgent extends BaseAgent<WeeklyReportAgentInput, WeeklyReportResult> {
  constructor(agentId: string = WEEKLY_REPORT_AGENT_DECLARATION.agentId) {
    super({ agentId, agentType: WEEKLY_REPORT_AGENT_DECLARATION.agentType, name: "Weekly Report Agent", version: WEEKLY_REPORT_AGENT_DECLARATION.version, capabilities: WEEKLY_REPORT_AGENT_DECLARATION.capabilities });
  }

  async execute(request: AgentRequest<WeeklyReportAgentInput>): Promise<AgentResponse<WeeklyReportResult>> {
    const { input } = request;
    const ticketCounts = countTicketsByStatus(input.settlements);
    const settledCount = ticketCounts.won + ticketCounts.lost;
    const predictionWinRate = settledCount > 0 ? ticketCounts.won / settledCount : null;

    const result: WeeklyReportResult = {
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      ticketCounts,
      predictionWinRate,
      executedWagerPerformance: undefined,
      generatedAt: new Date().toISOString(),
    };
    return { requestId: request.requestId, output: result, completedAt: new Date().toISOString() };
  }
}
