import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatMarketLabel, formatMoney, formatOdds, formatPercent, formatSignedPercent, minutesSince } from "./format.js";

describe("formatMoney", () => {
  it("never renders a null Money as zero — the caller's explicit fallback wins (Section 09 §25)", () => {
    expect(formatMoney(null, "Not executed")).toBe("Not executed");
    expect(formatMoney(null, "Pending")).toBe("Pending");
  });

  it("formats a real amount with its real currency", () => {
    const result = formatMoney({ amount: 1500, currency: "NGN" }, "fallback");
    expect(result).toContain("NGN");
    expect(result).toContain("1,500");
  });

  it("never throws and never silently drops the currency for an unrecognized ISO code", () => {
    const result = formatMoney({ amount: 10, currency: "ZZZ" }, "fallback");
    expect(result).toContain("ZZZ");
    expect(result).toContain("10");
  });

  it("renders a real zero amount as zero, distinct from the null fallback (Section 09 §25 — zero and unknown are different states)", () => {
    const result = formatMoney({ amount: 0, currency: "NGN" }, "Not executed");
    expect(result).not.toBe("Not executed");
  });
});

describe("formatPercent / formatSignedPercent", () => {
  it("returns the fallback for null, never 0%", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatSignedPercent(null)).toBe("—");
  });

  it("formats a real probability as a percentage", () => {
    expect(formatPercent(0.612)).toBe("61.2%");
  });

  it("signs a positive edge/EV explicitly with a leading +", () => {
    expect(formatSignedPercent(0.071)).toBe("+7.1%");
    expect(formatSignedPercent(-0.05)).toBe("-5.0%");
  });
});

describe("formatOdds", () => {
  it("returns the fallback for null", () => {
    expect(formatOdds(null)).toBe("—");
  });

  it("formats real odds to two decimals", () => {
    expect(formatOdds(1.85)).toBe("1.85");
  });
});

describe("formatDateTime / formatDate", () => {
  it("returns the fallback for null/invalid input, never a crash or 'Invalid Date' string", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime("not-a-date")).toBe("—");
    expect(formatDate(null)).toBe("—");
    expect(formatDate("not-a-date")).toBe("—");
  });

  it("formats a real ISO timestamp", () => {
    expect(formatDateTime("2026-01-15T18:30:00Z")).not.toBe("—");
  });
});

describe("minutesSince", () => {
  it("returns null for missing/invalid input — never a fabricated freshness signal", () => {
    expect(minutesSince(null)).toBeNull();
    expect(minutesSince("not-a-date")).toBeNull();
  });

  it("computes real elapsed minutes", () => {
    const now = new Date("2026-01-01T00:30:00Z");
    expect(minutesSince("2026-01-01T00:00:00Z", now)).toBe(30);
  });

  it("never returns a negative value for a timestamp slightly in the future (clock skew)", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(minutesSince("2026-01-01T00:05:00Z", now)).toBe(0);
  });
});

describe("formatMarketLabel", () => {
  it("renders a known market type with a human label", () => {
    expect(formatMarketLabel("match_result_1x2", "HOME", null)).toBe("Match Result — HOME");
  });

  it("includes the line when present", () => {
    expect(formatMarketLabel("over_under", "OVER", 2.5)).toBe("Over/Under 2.5 — OVER");
  });

  it("never hides an unrecognized market type — renders the raw value rather than disappearing", () => {
    expect(formatMarketLabel("some_future_market", "X", null)).toBe("some_future_market — X");
  });
});
