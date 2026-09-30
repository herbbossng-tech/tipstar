import { describe, expect, it } from "vitest";
import { buildPerformanceLedgerEntry, computeClosingLineValue, computeLongestLosingStreak, computeMaxDrawdown, type PerformanceRecordInput } from "./performance.js";
import { LedgerMode, SettlementStatus, type Money } from "./types.js";

function money(amount: number, currency = "NGN"): Money {
  return { amount, currency };
}

function record(overrides: Partial<PerformanceRecordInput> = {}): PerformanceRecordInput {
  return { status: SettlementStatus.WON, ledgerMode: LedgerMode.LIVE, legCount: 1, executed: true, actualStake: money(100), actualPayout: money(200), expectedEv: 0.2, settledAt: "2026-02-01T00:00:00Z", ...overrides };
}

describe("computeMaxDrawdown", () => {
  it("returns null for an empty sequence", () => {
    expect(computeMaxDrawdown([])).toBeNull();
  });

  it("returns 0 for a monotonically increasing equity curve", () => {
    expect(computeMaxDrawdown([10, 10, 10])).toBe(0);
  });

  it("computes the largest peak-to-trough drop over a real sequence", () => {
    // cumulative: 100, 150, 90, 70, 120 -> peak 150, trough 70 -> drawdown 80
    expect(computeMaxDrawdown([100, 50, -60, -20, 50])).toBe(80);
  });

  it("a single loss produces a drawdown equal to its magnitude", () => {
    expect(computeMaxDrawdown([-40])).toBe(40);
  });
});

describe("computeLongestLosingStreak", () => {
  it("returns null for an empty sequence", () => {
    expect(computeLongestLosingStreak([])).toBeNull();
  });

  it("counts the longest consecutive run of negative P&L values", () => {
    expect(computeLongestLosingStreak([10, -5, -5, -5, 10, -5])).toBe(3);
  });

  it("a break-even (0) ticket resets the streak — it is not a loss", () => {
    expect(computeLongestLosingStreak([-5, -5, 0, -5])).toBe(2);
  });

  it("returns 0 when there are no losses at all", () => {
    expect(computeLongestLosingStreak([10, 20, 30])).toBe(0);
  });
});

describe("computeClosingLineValue", () => {
  it("computes positive CLV when decision odds beat the closing line", () => {
    // decision 2.20 vs closing 2.00 -> the market shortened, in the bettor's favor
    expect(computeClosingLineValue({ decisionOdds: 2.2, closingOdds: 2.0 })).toBeCloseTo(0.1, 6);
  });

  it("computes negative CLV when the closing line drifted the other way", () => {
    expect(computeClosingLineValue({ decisionOdds: 1.8, closingOdds: 2.0 })).toBeCloseTo(-0.1, 6);
  });

  it("returns undefined — never fabricated — when closing odds are unavailable/invalid", () => {
    expect(computeClosingLineValue({ decisionOdds: 2.0, closingOdds: 1 })).toBeUndefined();
    expect(computeClosingLineValue({ decisionOdds: 2.0, closingOdds: Number.NaN })).toBeUndefined();
  });

  it("returns undefined for invalid decision odds too", () => {
    expect(computeClosingLineValue({ decisionOdds: 0.5, closingOdds: 2.0 })).toBeUndefined();
  });
});

describe("buildPerformanceLedgerEntry", () => {
  const period = { periodStart: "2026-02-01T00:00:00Z", periodEnd: "2026-02-28T00:00:00Z" };

  it("counts tickets and legs correctly, respecting the accumulator rule (§24)", () => {
    const entry = buildPerformanceLedgerEntry({
      records: [record({ legCount: 1 }), record({ legCount: 5, status: SettlementStatus.LOST, actualPayout: money(0) })],
      ...period,
      ledgerMode: LedgerMode.LIVE,
      sport: "football",
    });
    expect(entry.ticketCount).toBe(2);
    expect(entry.legCount).toBe(6);
    expect(entry.wins).toBe(1);
    expect(entry.losses).toBe(1);
  });

  it("only aggregates records matching the requested ledgerMode — paper never leaks into live (§22)", () => {
    const entry = buildPerformanceLedgerEntry({
      records: [record({ ledgerMode: LedgerMode.LIVE }), record({ ledgerMode: LedgerMode.PAPER, actualStake: money(9999) })],
      ...period,
      ledgerMode: LedgerMode.LIVE,
      sport: "football",
    });
    expect(entry.ticketCount).toBe(1);
    expect(entry.actualStake).toEqual(money(100));
  });

  it("sums actual stake/payout/P&L only over records with BOTH known — never a partial/misleading total", () => {
    const entry = buildPerformanceLedgerEntry({
      records: [record(), record({ actualStake: money(50), actualPayout: null, status: SettlementStatus.PENDING, settledAt: null })],
      ...period,
      ledgerMode: LedgerMode.LIVE,
      sport: "football",
    });
    expect(entry.actualStake).toEqual(money(100)); // the pending record's 50 is excluded, not added in
    expect(entry.actualPayout).toEqual(money(200));
    expect(entry.actualPnl).toEqual(money(100));
    expect(entry.roi).toBeCloseTo(1.0, 6);
  });

  it("computes max drawdown and longest losing streak from exactly one net-P&L number per ticket, in settlement order", () => {
    const entry = buildPerformanceLedgerEntry({
      records: [
        record({ actualStake: money(100), actualPayout: money(150), settledAt: "2026-02-01T00:00:00Z" }), // +50
        record({ status: SettlementStatus.LOST, actualStake: money(100), actualPayout: money(0), settledAt: "2026-02-02T00:00:00Z" }), // -100
        record({ status: SettlementStatus.LOST, actualStake: money(100), actualPayout: money(0), settledAt: "2026-02-03T00:00:00Z" }), // -100
      ],
      ...period,
      ledgerMode: LedgerMode.LIVE,
      sport: "football",
    });
    expect(entry.maxDrawdown).toBe(200); // peak 50, trough -150
    expect(entry.longestLosingStreak).toBe(2);
  });

  it("exposes sample size on every entry, even a tiny one (§37)", () => {
    const entry = buildPerformanceLedgerEntry({ records: [record()], ...period, ledgerMode: LedgerMode.LIVE, sport: "football" });
    expect(entry.sampleSize).toBe(1);
  });

  it("averages expected EV only over records that actually report it — never fabricated for the rest", () => {
    const entry = buildPerformanceLedgerEntry({
      records: [record({ expectedEv: 0.1 }), record({ expectedEv: 0.3 }), record({ expectedEv: undefined })],
      ...period,
      ledgerMode: LedgerMode.LIVE,
      sport: "football",
    });
    expect(entry.expectedEv).toBeCloseTo(0.2, 6);
  });

  it("returns null (never NaN) expectedEv when no record reports one", () => {
    const entry = buildPerformanceLedgerEntry({ records: [record({ expectedEv: undefined })], ...period, ledgerMode: LedgerMode.LIVE, sport: "football" });
    expect(entry.expectedEv).toBeNull();
  });

  it("carries the requested breakdown dimensions through untouched", () => {
    const entry = buildPerformanceLedgerEntry({ records: [record()], ...period, ledgerMode: LedgerMode.LIVE, sport: "football", league: "Premier League", market: "match_result_1x2", modelVersion: "model-v3" });
    expect(entry.sport).toBe("football");
    expect(entry.league).toBe("Premier League");
    expect(entry.market).toBe("match_result_1x2");
    expect(entry.modelVersion).toBe("model-v3");
  });
});
