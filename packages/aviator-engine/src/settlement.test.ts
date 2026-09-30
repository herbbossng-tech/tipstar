import { LedgerMode, SettlementStatus } from "@sport-os/settlement-engine";
import { describe, expect, it } from "vitest";
import { buildDefaultDoubleBetLegs, settleDoubleBetLeg, type DoubleBetRecord } from "./double-bet.js";
import { deriveLegSettlementStatus, settleDoubleBet } from "./settlement.js";

const NOW = "2026-02-01T20:00:00Z";

function buildRecord(): DoubleBetRecord {
  const { target1, target2 } = buildDefaultDoubleBetLegs({ totalStake: 100, target1Multiplier: 1.5, target2Multiplier: 3.0 });
  return { doubleBetId: "db-1", signalId: "sig-1", roundId: "round-1", target1, target2, totalStake: 100, totalReturn: undefined, netPnl: undefined, roi: undefined, createdAt: NOW };
}

describe("deriveLegSettlementStatus", () => {
  it("is PENDING for an unsettled leg", () => {
    const record = buildRecord();
    expect(deriveLegSettlementStatus(record.target1)).toBe(SettlementStatus.PENDING);
  });

  it("is WON when the real settled P&L is positive", () => {
    const record = buildRecord();
    const settled = settleDoubleBetLeg(record.target1, 2.0, NOW); // cashed above target1's own 1.5x is irrelevant here — this settles at a real exit of 2.0x
    expect(deriveLegSettlementStatus(settled)).toBe(SettlementStatus.WON);
  });

  it("is LOST when the round crashed before this leg's target (pnl = -stake)", () => {
    const record = buildRecord();
    const settled = settleDoubleBetLeg(record.target1, null, NOW);
    expect(settled.pnl).toBe(-50);
    expect(deriveLegSettlementStatus(settled)).toBe(SettlementStatus.LOST);
  });

  it("is PUSH on an exact break-even exit (1.0x)", () => {
    const record = buildRecord();
    const settled = settleDoubleBetLeg(record.target1, 1.0, NOW);
    expect(settled.pnl).toBe(0);
    expect(deriveLegSettlementStatus(settled)).toBe(SettlementStatus.PUSH);
  });
});

describe("settleDoubleBet — legs settle independently (§20)", () => {
  it("stays PENDING while either leg is unsettled", () => {
    const record = buildRecord();
    const settled = settleDoubleBet(record, { currency: "NGN", ledgerMode: LedgerMode.LIVE, source: "test", now: NOW });
    expect(settled.status).toBe(SettlementStatus.PENDING);
    expect(settled.actualPayout).toBeNull();
    expect(settled.settledAt).toBeNull();
  });

  it("one leg winning while the other loses is preserved per-leg, never collapsed before settlement", () => {
    const record = buildRecord();
    const target1 = settleDoubleBetLeg(record.target1, 2.0, NOW); // target1 (1.5x target) cashes above its own target -> real win
    const target2 = settleDoubleBetLeg(record.target2, null, NOW); // target2 (3.0x target) crashes before cashing -> real loss
    const settled = settleDoubleBet({ ...record, target1, target2 }, { currency: "NGN", ledgerMode: LedgerMode.LIVE, source: "test", now: NOW });
    expect(settled.legs[0].status).toBe(SettlementStatus.WON);
    expect(settled.legs[1].status).toBe(SettlementStatus.LOST);
    // target1: stake 50 * 2.0 = 100 return, pnl +50. target2: stake 50, crashed, pnl -50. Net exactly 0.
    expect(settled.netPnl).toEqual({ amount: 0, currency: "NGN" });
    expect(settled.status).toBe(SettlementStatus.PUSH);
    expect(settled.settledAt).toBe(NOW);
  });

  it("both legs winning resolves the combined ticket to WON with real net P&L and ROI", () => {
    const record = buildRecord();
    const target1 = settleDoubleBetLeg(record.target1, 2.0, NOW); // 50 * 2.0 = 100, pnl +50
    const target2 = settleDoubleBetLeg(record.target2, 4.0, NOW); // 50 * 4.0 = 200, pnl +150
    const settled = settleDoubleBet({ ...record, target1, target2 }, { currency: "NGN", ledgerMode: LedgerMode.LIVE, source: "test", now: NOW });
    expect(settled.status).toBe(SettlementStatus.WON);
    expect(settled.actualStake).toEqual({ amount: 100, currency: "NGN" });
    expect(settled.actualPayout).toEqual({ amount: 300, currency: "NGN" });
    expect(settled.netPnl).toEqual({ amount: 200, currency: "NGN" });
    expect(settled.roi).toBeCloseTo(2.0, 6);
  });

  it("both legs crashing resolves the combined ticket to LOST", () => {
    const record = buildRecord();
    const target1 = settleDoubleBetLeg(record.target1, null, NOW);
    const target2 = settleDoubleBetLeg(record.target2, null, NOW);
    const settled = settleDoubleBet({ ...record, target1, target2 }, { currency: "NGN", ledgerMode: LedgerMode.PAPER, source: "test", now: NOW });
    expect(settled.status).toBe(SettlementStatus.LOST);
    expect(settled.actualPayout).toEqual({ amount: 0, currency: "NGN" });
    expect(settled.netPnl).toEqual({ amount: -100, currency: "NGN" });
    expect(settled.ledgerMode).toBe(LedgerMode.PAPER);
  });

  it("carries the paper/live ledger mode through untouched", () => {
    const record = buildRecord();
    const target1 = settleDoubleBetLeg(record.target1, 2.0, NOW);
    const target2 = settleDoubleBetLeg(record.target2, 2.0, NOW);
    const settled = settleDoubleBet({ ...record, target1, target2 }, { currency: "KES", ledgerMode: LedgerMode.PAPER, source: "backtest", now: NOW });
    expect(settled.ledgerMode).toBe(LedgerMode.PAPER);
    expect(settled.actualStake.currency).toBe("KES");
    expect(settled.source).toBe("backtest");
  });
});
