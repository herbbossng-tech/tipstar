import { generateId, type ISODateString } from "@sport-os/shared";
import { SettlementStatus, type LedgerMode, type Money, type PerformanceRecordInput } from "@sport-os/settlement-engine";
import { combineDoubleBetLegs, type DoubleBetLeg, type DoubleBetRecord } from "./double-bet.js";

/**
 * Aviator + Double Bet Settlement (Section 08 §19/§20). Derives the
 * canonical, cross-sport `SettlementStatus` for Double Bet records from
 * their ALREADY-REAL settlement arithmetic (`settleDoubleBetLeg`/
 * `combineDoubleBetLegs`, Section 06) — this module recomputes NOTHING
 * about stake/exit/return/P&L; it only labels the existing real numbers
 * with the locked settlement state machine so Aviator results are
 * reportable through the same `PerformanceLedgerEntry` shape football
 * settlements use.
 *
 * "Settlement must use actual recorded exit/payout when available. Do
 * not infer actual cashout from a signal." — `deriveLegSettlementStatus`
 * only ever reads `DoubleBetLeg.pnl`/`settledAt`, both of which are only
 * ever set by a REAL `settleDoubleBetLeg()` call against a REAL
 * `actualExitMultiplier`; nothing here can produce a WON/LOST status for
 * a leg that hasn't actually settled.
 *
 * "One leg may win while the other loses. Do not collapse the two legs
 * before individual settlement." — `DoubleBetSettlement.legs` always
 * carries BOTH legs' independent status; the ticket-level `status` is a
 * separate, later aggregation over the net P&L, never a substitute for
 * the per-leg detail.
 */

/** PENDING until the leg has actually settled (`settledAt`/`pnl` both known); WON/LOST by the sign of the real P&L — a round that crashed before the target (pnl = -stake) is a real, valid LOST outcome, never "unknown". An exact break-even exit (pnl === 0, e.g. cashing out at precisely 1.0x) is labeled PUSH — the same "no real gain or loss" convention the ticket-level aggregation below uses, since Aviator has no bookmaker-style void/push concept of its own to borrow. */
export function deriveLegSettlementStatus(leg: DoubleBetLeg): SettlementStatus {
  if (leg.settledAt === undefined || leg.pnl === undefined) return SettlementStatus.PENDING;
  if (leg.pnl > 0) return SettlementStatus.WON;
  if (leg.pnl < 0) return SettlementStatus.LOST;
  return SettlementStatus.PUSH;
}

export interface DoubleBetLegSettlement {
  readonly target: DoubleBetLeg["target"];
  readonly status: SettlementStatus;
  readonly stake: number;
  readonly actualExitMultiplier: number | undefined;
  readonly return: number | undefined;
  readonly pnl: number | undefined;
}

export function settleDoubleBetLegRecord(leg: DoubleBetLeg): DoubleBetLegSettlement {
  return { target: leg.target, status: deriveLegSettlementStatus(leg), stake: leg.stake, actualExitMultiplier: leg.actualExitMultiplier, return: leg.return, pnl: leg.pnl };
}

export interface DoubleBetSettlement {
  readonly settlementId: string;
  readonly doubleBetId: string;
  /** The combined, net outcome — PENDING until BOTH legs have settled; otherwise WON/LOST/PUSH by the sign of `netPnl` (§25's "average P&L per ticket" and the performance ledger need one number per Double Bet, exactly like a football accumulator collapses to one ticket-level status — see `LegSettlement`/`settleTicketLegs` in `@sport-os/football-engine`). A net-zero outcome (one leg's gain exactly offsets the other's loss) is labeled PUSH — a documented convention, since Aviator has no bookmaker-style push/void concept of its own to borrow. */
  readonly status: SettlementStatus;
  readonly legs: readonly [DoubleBetLegSettlement, DoubleBetLegSettlement];
  readonly ledgerMode: LedgerMode;
  readonly actualStake: Money;
  /** `null` until both legs have settled (`combineDoubleBetLegs` itself returns `totalReturn: undefined` until then — never a fabricated interim payout). */
  readonly actualPayout: Money | null;
  readonly netPnl: Money | null;
  readonly roi: number | null;
  readonly settledAt: ISODateString | null;
  readonly source: string;
}

export interface SettleDoubleBetParams {
  readonly currency: string;
  readonly ledgerMode: LedgerMode;
  readonly source: string;
  readonly now: ISODateString;
}

export function settleDoubleBet(record: DoubleBetRecord, params: SettleDoubleBetParams): DoubleBetSettlement {
  const leg1 = settleDoubleBetLegRecord(record.target1);
  const leg2 = settleDoubleBetLegRecord(record.target2);
  const bothSettled = leg1.status !== SettlementStatus.PENDING && leg2.status !== SettlementStatus.PENDING;
  const combined = combineDoubleBetLegs(record.target1, record.target2);

  const status: SettlementStatus = !bothSettled || combined.netPnl === undefined ? SettlementStatus.PENDING : combined.netPnl > 0 ? SettlementStatus.WON : combined.netPnl < 0 ? SettlementStatus.LOST : SettlementStatus.PUSH;

  return {
    settlementId: generateId(),
    doubleBetId: record.doubleBetId,
    status,
    legs: [leg1, leg2],
    ledgerMode: params.ledgerMode,
    actualStake: { amount: combined.totalStake, currency: params.currency },
    actualPayout: combined.totalReturn !== undefined ? { amount: combined.totalReturn, currency: params.currency } : null,
    netPnl: combined.netPnl !== undefined ? { amount: combined.netPnl, currency: params.currency } : null,
    roi: combined.roi ?? null,
    settledAt: bothSettled ? params.now : null,
    source: params.source,
  };
}

/** The Aviator twin of `@sport-os/football-engine/settlement.ts`'s `toPerformanceRecordInput` — same sport-agnostic target shape, never a second aggregation algorithm. A Double Bet is always one ticket-equivalent unit (`legCount: 1`) for performance-counting purposes — its own two independent legs are a settlement-internal detail, not something the performance ledger breaks tickets/legs out by. */
export function toPerformanceRecordInput(settlement: DoubleBetSettlement, expectedEv?: number): PerformanceRecordInput {
  return {
    status: settlement.status,
    ledgerMode: settlement.ledgerMode,
    legCount: 1,
    executed: true,
    actualStake: settlement.actualStake,
    actualPayout: settlement.actualPayout,
    expectedEv,
    settledAt: settlement.settledAt,
  };
}
