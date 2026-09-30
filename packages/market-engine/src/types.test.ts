import { describe, expect, it } from "vitest";
import { checkOddsValidity, computeFairOdds, computeImpliedProbability, computeMarketOverround, MarketStatus } from "./types.js";

describe("computeImpliedProbability", () => {
  it("computes 1/odds for valid decimal odds", () => {
    expect(computeImpliedProbability(2.0)).toBeCloseTo(0.5);
    expect(computeImpliedProbability(4.0)).toBeCloseTo(0.25);
  });

  it("returns undefined for null, non-positive, or non-finite odds — never a fabricated probability", () => {
    expect(computeImpliedProbability(null)).toBeUndefined();
    expect(computeImpliedProbability(1)).toBeUndefined();
    expect(computeImpliedProbability(0)).toBeUndefined();
    expect(computeImpliedProbability(-2)).toBeUndefined();
    expect(computeImpliedProbability(Infinity)).toBeUndefined();
    expect(computeImpliedProbability(NaN)).toBeUndefined();
  });
});

describe("computeFairOdds", () => {
  it("computes 1/probability, rounded to 4 decimal places", () => {
    expect(computeFairOdds(0.5)).toBe(2);
    expect(computeFairOdds(1 / 3)).toBeCloseTo(3, 4);
  });

  it("returns undefined for probability <= 0 or non-finite", () => {
    expect(computeFairOdds(0)).toBeUndefined();
    expect(computeFairOdds(-0.1)).toBeUndefined();
    expect(computeFairOdds(NaN)).toBeUndefined();
  });

  it("never adds a bookmaker margin — fair odds for a 3-outcome even split sum their implied probabilities to exactly 1", () => {
    const home = computeFairOdds(1 / 3)!;
    const draw = computeFairOdds(1 / 3)!;
    const away = computeFairOdds(1 / 3)!;
    const impliedSum = 1 / home + 1 / draw + 1 / away;
    expect(impliedSum).toBeCloseTo(1, 3);
  });
});

describe("computeMarketOverround", () => {
  it("computes the bookmaker's real overround from real quoted odds", () => {
    // A typical 1X2 market: implied sum > 1 (the bookmaker's margin).
    const overround = computeMarketOverround([2.0, 3.4, 4.0]);
    expect(overround).toBeGreaterThan(1);
    expect(overround).toBeCloseTo(1 / 2.0 + 1 / 3.4 + 1 / 4.0, 6);
  });

  it("never removes the margin — this function only measures it", () => {
    const overround = computeMarketOverround([2.0, 2.0])!;
    // Fair 50/50 odds would each be exactly 2.0, summing to 1 — any
    // real bookmaker margin pushes this above 1, and this function
    // reports that raw sum without adjustment.
    expect(overround).toBeCloseTo(1, 6);
  });

  it("returns undefined if any selection's odds are missing/invalid — never computed from a partial set", () => {
    expect(computeMarketOverround([2.0, null, 4.0])).toBeUndefined();
    expect(computeMarketOverround([2.0, 1, 4.0])).toBeUndefined();
  });
});

describe("checkOddsValidity", () => {
  const config = { maxOddsAgeSeconds: 120 };
  const evaluationTime = "2026-01-10T18:00:00Z";

  it("accepts fresh, valid, open odds", () => {
    const result = checkOddsValidity({ odds: 2.0, oddsTimestamp: "2026-01-10T17:59:00Z", status: MarketStatus.OPEN }, evaluationTime, config);
    expect(result.valid).toBe(true);
  });

  it("rejects missing odds (null)", () => {
    const result = checkOddsValidity({ odds: null, oddsTimestamp: "2026-01-10T17:59:00Z", status: MarketStatus.OPEN }, evaluationTime, config);
    expect(result).toEqual({ valid: false, reason: "MISSING_ODDS" });
  });

  it("rejects odds <= 1", () => {
    const result = checkOddsValidity({ odds: 1, oddsTimestamp: "2026-01-10T17:59:00Z", status: MarketStatus.OPEN }, evaluationTime, config);
    expect(result).toEqual({ valid: false, reason: "NON_POSITIVE_ODDS" });
  });

  it("rejects stale odds beyond the configured freshness threshold", () => {
    const result = checkOddsValidity({ odds: 2.0, oddsTimestamp: "2026-01-10T17:00:00Z", status: MarketStatus.OPEN }, evaluationTime, config);
    expect(result).toEqual({ valid: false, reason: "STALE_ODDS" });
  });

  it("rejects an odds timestamp in the future relative to the evaluation snapshot", () => {
    const result = checkOddsValidity({ odds: 2.0, oddsTimestamp: "2026-01-10T18:05:00Z", status: MarketStatus.OPEN }, evaluationTime, config);
    expect(result).toEqual({ valid: false, reason: "FUTURE_TIMESTAMP" });
  });

  it("rejects a suspended market even with otherwise-valid odds", () => {
    const result = checkOddsValidity({ odds: 2.0, oddsTimestamp: "2026-01-10T17:59:00Z", status: MarketStatus.SUSPENDED }, evaluationTime, config);
    expect(result).toEqual({ valid: false, reason: "MARKET_SUSPENDED" });
  });

  it("rejects a cancelled market", () => {
    const result = checkOddsValidity({ odds: 2.0, oddsTimestamp: "2026-01-10T17:59:00Z", status: MarketStatus.CANCELLED }, evaluationTime, config);
    expect(result).toEqual({ valid: false, reason: "MARKET_CANCELLED" });
  });
});
