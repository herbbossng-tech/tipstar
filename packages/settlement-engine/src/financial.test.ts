import { describe, expect, it } from "vitest";
import { addMoney, assertSameCurrency, computeNetPnl, computeRoi, subtractMoney, sumMoney } from "./financial.js";
import type { Money } from "./types.js";

function money(amount: number, currency = "NGN"): Money {
  return { amount, currency };
}

describe("assertSameCurrency / addMoney / subtractMoney", () => {
  it("adds two amounts in the same currency", () => {
    expect(addMoney(money(100), money(50))).toEqual(money(150));
  });

  it("subtracts two amounts in the same currency", () => {
    expect(subtractMoney(money(100), money(30))).toEqual(money(70));
  });

  it("throws CURRENCY_MISMATCH rather than silently combining NGN and KES", () => {
    expect(() => addMoney(money(100, "NGN"), money(50, "KES"))).toThrow(/CURRENCY_MISMATCH|NGN.*KES/);
  });

  it("assertSameCurrency does not throw for matching currencies", () => {
    expect(() => assertSameCurrency(money(1, "USD"), money(2, "USD"))).not.toThrow();
  });
});

describe("sumMoney", () => {
  it("sums a list of same-currency amounts", () => {
    expect(sumMoney([money(10), money(20), money(30)])).toEqual(money(60));
  });

  it("returns undefined for an empty list — never a fabricated zero", () => {
    expect(sumMoney([])).toBeUndefined();
  });

  it("throws on the first mismatched currency rather than silently dropping it", () => {
    expect(() => sumMoney([money(10, "NGN"), money(20, "KES")])).toThrow();
  });
});

describe("computeNetPnl", () => {
  it("computes actual_payout - actual_stake for a real executed wager", () => {
    expect(computeNetPnl(money(100), money(180))).toEqual(money(80));
  });

  it("returns null (never 0) when actual stake is unknown", () => {
    expect(computeNetPnl(null, money(180))).toBeNull();
  });

  it("returns null (never 0) when actual payout is unknown", () => {
    expect(computeNetPnl(money(100), null)).toBeNull();
  });

  it("returns null when both are unknown — an unexecuted ticket has no actual P&L", () => {
    expect(computeNetPnl(null, null)).toBeNull();
  });

  it("a real, computed zero net P&L (break-even) is distinct from null", () => {
    const result = computeNetPnl(money(100), money(100));
    expect(result).toEqual(money(0));
    expect(result).not.toBeNull();
  });
});

describe("computeRoi", () => {
  it("computes roi = net_pnl / actual_stake", () => {
    expect(computeRoi(money(50), money(100))).toBeCloseTo(0.5, 6);
  });

  it("returns null for a zero actual stake — never Infinity/NaN", () => {
    const result = computeRoi(money(0), money(0));
    expect(result).toBeNull();
    expect(result).not.toBe(Infinity);
    expect(Number.isNaN(result as number)).toBe(false);
  });

  it("returns null for a negative/zero stake even with a real net P&L", () => {
    expect(computeRoi(money(50), money(0))).toBeNull();
  });

  it("returns null when net P&L is unknown", () => {
    expect(computeRoi(null, money(100))).toBeNull();
  });

  it("returns null when actual stake is unknown", () => {
    expect(computeRoi(money(50), null)).toBeNull();
  });
});
