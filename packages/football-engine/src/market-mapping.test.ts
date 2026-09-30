import { MarketType } from "@sport-os/market-engine";
import { describe, expect, it } from "vitest";
import { mapAllSupportedMarkets, mapProbabilityToMarket, type ProbabilityInputs } from "./market-mapping.js";

const probability1x2 = { home: 0.5, draw: 0.3, away: 0.2 };

describe("mapProbabilityToMarket", () => {
  it("maps 1X2 directly", () => {
    const result = mapProbabilityToMarket({ probability1x2 }, MarketType.MATCH_RESULT_1X2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.markets).toEqual([
        { marketType: MarketType.MATCH_RESULT_1X2, selection: "HOME", line: undefined, probability: 0.5 },
        { marketType: MarketType.MATCH_RESULT_1X2, selection: "DRAW", line: undefined, probability: 0.3 },
        { marketType: MarketType.MATCH_RESULT_1X2, selection: "AWAY", line: undefined, probability: 0.2 },
      ]);
    }
  });

  it("derives Double Chance using the exact §6 formulas", () => {
    const result = mapProbabilityToMarket({ probability1x2 }, MarketType.DOUBLE_CHANCE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const bySelection = Object.fromEntries(result.markets.map((m) => [m.selection, m.probability]));
      expect(bySelection["1X"]).toBeCloseTo(0.8); // home + draw
      expect(bySelection["X2"]).toBeCloseTo(0.5); // draw + away
      expect(bySelection["12"]).toBeCloseTo(0.7); // home + away
    }
  });

  it("returns MARKET_UNSUPPORTED for BTTS when no BTTS probability was supplied — never fabricates one", () => {
    const result = mapProbabilityToMarket({ probability1x2 }, MarketType.BOTH_TEAMS_TO_SCORE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("MARKET_UNSUPPORTED");
  });

  it("maps BTTS when a real BTTS probability is supplied", () => {
    const inputs: ProbabilityInputs = { probability1x2, btts: { yes: 0.55, no: 0.45 } };
    const result = mapProbabilityToMarket(inputs, MarketType.BOTH_TEAMS_TO_SCORE);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.markets.find((m) => m.selection === "YES")?.probability).toBe(0.55);
  });

  it("maps Over/Under for a specific supplied line, MARKET_UNSUPPORTED for a line not supplied", () => {
    const inputs: ProbabilityInputs = { probability1x2, overUnder: { "2.5": { yes: 0.6, no: 0.4 } } };
    const supported = mapProbabilityToMarket(inputs, MarketType.OVER_UNDER, 2.5);
    expect(supported.ok).toBe(true);
    if (supported.ok) {
      expect(supported.markets).toEqual([
        { marketType: MarketType.OVER_UNDER, selection: "OVER", line: 2.5, probability: 0.6 },
        { marketType: MarketType.OVER_UNDER, selection: "UNDER", line: 2.5, probability: 0.4 },
      ]);
    }
    const unsupported = mapProbabilityToMarket(inputs, MarketType.OVER_UNDER, 3.5);
    expect(unsupported.ok).toBe(false);
  });

  it("maps Correct Score from a real scoreline distribution", () => {
    const inputs: ProbabilityInputs = { probability1x2, correctScoreDistribution: [{ homeGoals: 1, awayGoals: 0, probability: 0.2 }, { homeGoals: 0, awayGoals: 0, probability: 0.15 }] };
    const result = mapProbabilityToMarket(inputs, MarketType.CORRECT_SCORE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.markets).toEqual([
        { marketType: MarketType.CORRECT_SCORE, selection: "1-0", line: undefined, probability: 0.2 },
        { marketType: MarketType.CORRECT_SCORE, selection: "0-0", line: undefined, probability: 0.15 },
      ]);
    }
  });

  it.each([MarketType.TEAM_TOTALS, MarketType.ASIAN_HANDICAP, MarketType.EUROPEAN_HANDICAP, MarketType.CORNERS, MarketType.CARDS, MarketType.FIRST_HALF, MarketType.SECOND_HALF])(
    "returns MARKET_UNSUPPORTED for %s unconditionally — no model computes it",
    (marketType) => {
      const inputs: ProbabilityInputs = { probability1x2, btts: { yes: 0.5, no: 0.5 }, overUnder: { "2.5": { yes: 0.5, no: 0.5 } }, correctScoreDistribution: [{ homeGoals: 1, awayGoals: 0, probability: 1 }] };
      const result = mapProbabilityToMarket(inputs, marketType);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("MARKET_UNSUPPORTED");
    },
  );
});

describe("mapAllSupportedMarkets", () => {
  it("includes only 1X2 + Double Chance when no optional data is supplied", () => {
    const markets = mapAllSupportedMarkets({ probability1x2 });
    const marketTypes = new Set(markets.map((m) => m.marketType));
    expect(marketTypes).toEqual(new Set([MarketType.MATCH_RESULT_1X2, MarketType.DOUBLE_CHANCE]));
  });

  it("includes every market whose source data was actually supplied", () => {
    const inputs: ProbabilityInputs = {
      probability1x2,
      btts: { yes: 0.5, no: 0.5 },
      overUnder: { "2.5": { yes: 0.5, no: 0.5 } },
      correctScoreDistribution: [{ homeGoals: 1, awayGoals: 0, probability: 1 }],
    };
    const markets = mapAllSupportedMarkets(inputs);
    const marketTypes = new Set(markets.map((m) => m.marketType));
    expect(marketTypes).toEqual(new Set([MarketType.MATCH_RESULT_1X2, MarketType.DOUBLE_CHANCE, MarketType.BOTH_TEAMS_TO_SCORE, MarketType.OVER_UNDER, MarketType.CORRECT_SCORE]));
  });
});
