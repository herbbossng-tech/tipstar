import type { ISODateString } from "@sport-os/shared";
import { computeNetPnl, computeRoi, sumMoney } from "./financial.js";
import { SettlementStatus, type LedgerMode, type Money } from "./types.js";

/**
 * Performance metrics (Section 08 §25-28). Pure, deterministic
 * aggregation over already-realized numbers — never a prediction, never
 * fabricated. Callers must pre-filter to a single currency and a single
 * `LedgerMode` (paper vs live) before calling anything here — "never mix
 * them in the same financial performance aggregate unless explicitly
 * requested through a typed filter" (§22); these functions have no
 * currency/ledger-mode awareness of their own precisely so a caller
 * cannot forget that filtering step.
 */

/**
 * Maximum drawdown over a chronological realized-P&L equity curve (§26):
 * `equity_t = cumulative realized P&L`, `peak_t = max(previous equity)`,
 * `drawdown_t = peak_t - equity_t`. `null` for an empty sequence — never
 * `0` standing in for "no data."
 */
export function computeMaxDrawdown(realizedPnls: readonly number[]): number | null {
  if (realizedPnls.length === 0) return null;
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const pnl of realizedPnls) {
    cumulative += pnl;
    peak = Math.max(peak, cumulative);
    maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
  }
  return maxDrawdown;
}

/**
 * Longest consecutive run of settled LOSING tickets, in the chronological
 * order supplied (§27). "One losing accumulator = one losing ticket" —
 * this function only ever sees one number per TICKET (never per leg); it
 * is the caller's job (see `football-engine/settlement.ts`'s
 * `settleTicketLegs`) to have already collapsed a multi-leg ticket into
 * its single ticket-level outcome before this array is built. `null` for
 * an empty sequence.
 */
export function computeLongestLosingStreak(realizedPnls: readonly number[]): number | null {
  if (realizedPnls.length === 0) return null;
  let longest = 0;
  let current = 0;
  for (const pnl of realizedPnls) {
    if (pnl < 0) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

export interface ClosingLineValueInput {
  readonly decisionOdds: number;
  readonly closingOdds: number;
}

/**
 * Closing-Line Value (§28): `CLV = (decisionOdds / closingOdds) - 1`, a
 * fraction — positive means the decision odds were better than the
 * market's closing price (the market later shortened, in the bettor's
 * favor). `undefined` — never fabricated — whenever either odds figure is
 * missing or invalid; there is no "estimated closing line" in this
 * codebase. Deliberately unaware of any realized outcome: CLV is kept
 * separate from P&L (§28's own rule — "a ticket can have positive CLV and
 * lose").
 */
export function computeClosingLineValue(input: ClosingLineValueInput): number | undefined {
  if (!(input.decisionOdds > 1) || !Number.isFinite(input.decisionOdds)) return undefined;
  if (!(input.closingOdds > 1) || !Number.isFinite(input.closingOdds)) return undefined;
  return input.decisionOdds / input.closingOdds - 1;
}

/**
 * One aggregated performance breakdown bucket (§23/§29) — e.g. "LIVE
 * football tickets on match_result_1x2 for model-v3 in January." Every
 * dimension is optional (an unset dimension means "not broken out by
 * this axis" for this particular entry, not "unknown"). `sampleSize` is
 * mandatory and always present (§37 — "every performance aggregate
 * should expose sample size").
 */
export interface PerformanceLedgerEntry {
  readonly periodStart: ISODateString;
  readonly periodEnd: ISODateString;
  readonly ledgerMode: LedgerMode;
  readonly sport: string;
  readonly league: string | undefined;
  readonly market: string | undefined;
  readonly modelVersion: string | undefined;
  readonly decisionPolicyVersion: string | undefined;
  readonly ticketType: string | undefined;
  /** §24 — an accumulator is ONE ticket regardless of leg count. */
  readonly ticketCount: number;
  readonly legCount: number;
  readonly executedTicketCount: number;
  readonly settledTicketCount: number;
  readonly wins: number;
  readonly losses: number;
  readonly voids: number;
  readonly pushes: number;
  readonly pending: number;
  readonly actualStake: Money | null;
  readonly actualPayout: Money | null;
  readonly actualPnl: Money | null;
  readonly roi: number | null;
  readonly expectedEv: number | null;
  readonly maxDrawdown: number | null;
  readonly longestLosingStreak: number | null;
  readonly sampleSize: number;
}

/**
 * The minimal, sport-agnostic shape `buildPerformanceLedgerEntry` needs
 * from ONE already-settled record (a football `TicketSettlement` or an
 * Aviator `DoubleBetSettlement`) — deliberately structural, not an import
 * of either concrete type, since `settlement-engine` cannot depend on
 * `football-engine`/`aviator-engine` (they already depend on it). Each of
 * those packages' own `settlement.ts` exposes a thin adapter
 * (`toPerformanceRecordInput`) that maps its real settlement type into
 * this shape — never a second aggregation algorithm.
 */
export interface PerformanceRecordInput {
  readonly status: SettlementStatus;
  readonly ledgerMode: LedgerMode;
  /** 1 for a football single or an Aviator Double Bet; >1 for a football accumulator (§24 — never one entry per leg). */
  readonly legCount: number;
  readonly executed: boolean;
  readonly actualStake: Money | null;
  readonly actualPayout: Money | null;
  /** The value-engine-reported expected EV for this ticket, when the caller has it available — `undefined` (never fabricated) otherwise. */
  readonly expectedEv: number | undefined;
  readonly settledAt: ISODateString | null;
}

export interface BuildPerformanceLedgerEntryParams {
  readonly records: readonly PerformanceRecordInput[];
  readonly periodStart: ISODateString;
  readonly periodEnd: ISODateString;
  /** Only records matching this `ledgerMode` are ever aggregated — a mixed-mode `records` array is filtered down first, so PAPER records can never leak into a LIVE entry or vice versa (§22). */
  readonly ledgerMode: LedgerMode;
  readonly sport: string;
  readonly league?: string;
  readonly market?: string;
  readonly modelVersion?: string;
  readonly decisionPolicyVersion?: string;
  readonly ticketType?: string;
}

/**
 * Builds one `PerformanceLedgerEntry` (§23/§25) from already-settled
 * records — pure aggregation, no I/O. `actualStake`/`actualPayout`/
 * `actualPnl`/`roi` are summed ONLY over records where BOTH an actual
 * stake and an actual payout are known (never mixing a known stake with
 * an unknown payout into a misleadingly-partial total). The drawdown/
 * losing-streak equity curve is built from exactly one net-P&L number per
 * TICKET (never per leg — §24/§27), ordered by `settledAt`.
 */
export function buildPerformanceLedgerEntry(params: BuildPerformanceLedgerEntryParams): PerformanceLedgerEntry {
  const records = params.records.filter((record) => record.ledgerMode === params.ledgerMode);

  const settledWithActuals = records.filter((record) => record.actualStake !== null && record.actualPayout !== null);
  const actualStake = sumMoney(settledWithActuals.map((record) => record.actualStake!)) ?? null;
  const actualPayout = sumMoney(settledWithActuals.map((record) => record.actualPayout!)) ?? null;
  const actualPnl = computeNetPnl(actualStake, actualPayout);
  const roi = computeRoi(actualPnl, actualStake);

  const pnlSequence = settledWithActuals
    .filter((record) => record.settledAt !== null)
    .sort((a, b) => new Date(a.settledAt!).getTime() - new Date(b.settledAt!).getTime())
    .map((record) => computeNetPnl(record.actualStake, record.actualPayout)!.amount);

  const evValues = records.map((record) => record.expectedEv).filter((value): value is number => value !== undefined);
  const expectedEv = evValues.length > 0 ? evValues.reduce((sum, value) => sum + value, 0) / evValues.length : null;

  return {
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    ledgerMode: params.ledgerMode,
    sport: params.sport,
    league: params.league,
    market: params.market,
    modelVersion: params.modelVersion,
    decisionPolicyVersion: params.decisionPolicyVersion,
    ticketType: params.ticketType,
    ticketCount: records.length,
    legCount: records.reduce((sum, record) => sum + record.legCount, 0),
    executedTicketCount: records.filter((record) => record.executed).length,
    settledTicketCount: records.filter((record) => record.status !== SettlementStatus.PENDING).length,
    wins: records.filter((record) => record.status === SettlementStatus.WON).length,
    losses: records.filter((record) => record.status === SettlementStatus.LOST).length,
    voids: records.filter((record) => record.status === SettlementStatus.VOID).length,
    pushes: records.filter((record) => record.status === SettlementStatus.PUSH).length,
    pending: records.filter((record) => record.status === SettlementStatus.PENDING).length,
    actualStake,
    actualPayout,
    actualPnl,
    roi,
    expectedEv,
    maxDrawdown: computeMaxDrawdown(pnlSequence),
    longestLosingStreak: computeLongestLosingStreak(pnlSequence),
    sampleSize: records.length,
  };
}
