import { MarketType } from "@sport-os/market-engine";
import type { BinaryProbability, Probability1x2, ScorelineDistribution } from "./probability/types.js";

/**
 * Probability → Market Contract (Section 07 §6). Deterministic,
 * pure — every market probability here is derived from an existing
 * Section 05 probability output (1X2, and where the model actually
 * computed them: BTTS, Over/Under, the correct-score distribution —
 * see `monte-carlo.ts`'s `MonteCarloResult`, which already produces all
 * of these from one consistent scoreline distribution). Lives in
 * `football-engine`, not `market-engine`, because it needs BOTH
 * football-specific probability shapes and `market-engine`'s
 * `MarketType` — `market-engine` cannot depend on `football-engine`
 * (the dependency runs the other way).
 *
 * "Where a market cannot be derived reliably: return MARKET_UNSUPPORTED.
 * Do not manufacture a probability." `TEAM_TOTALS`/`ASIAN_HANDICAP`/
 * `EUROPEAN_HANDICAP`/`CORNERS`/`CARDS`/`FIRST_HALF`/`SECOND_HALF` are
 * declared `MarketType` values (a complete canonical representation) but
 * no engine in this codebase computes a probability for any of them —
 * every one of those market types returns `MARKET_UNSUPPORTED` here,
 * unconditionally, until a real model exists.
 */

export interface MarketProbabilityResult {
  readonly marketType: MarketType;
  readonly selection: string;
  /** The line this selection was computed against (Over/Under's threshold) — undefined for line-less markets. */
  readonly line: number | undefined;
  readonly probability: number;
}

export type MarketMappingResult = { readonly ok: true; readonly markets: readonly MarketProbabilityResult[] } | { readonly ok: false; readonly reason: "MARKET_UNSUPPORTED"; readonly marketType: MarketType; readonly detail: string };

export interface ProbabilityInputs {
  readonly probability1x2: Probability1x2;
  /** Present only when the model actually computed BTTS (e.g. `MonteCarloResult.btts`) — never fabricated if absent. */
  readonly btts?: BinaryProbability;
  /** Keyed exactly like `MonteCarloResult.overUnder` — the threshold as a string, e.g. `"2.5"`. */
  readonly overUnder?: Readonly<Record<string, BinaryProbability>>;
  /** Present only when the model produced a real scoreline distribution (Poisson/Dixon-Coles/Monte Carlo) — never fabricated if absent. */
  readonly correctScoreDistribution?: ScorelineDistribution;
}

function map1x2(probability1x2: Probability1x2): readonly MarketProbabilityResult[] {
  return [
    { marketType: MarketType.MATCH_RESULT_1X2, selection: "HOME", line: undefined, probability: probability1x2.home },
    { marketType: MarketType.MATCH_RESULT_1X2, selection: "DRAW", line: undefined, probability: probability1x2.draw },
    { marketType: MarketType.MATCH_RESULT_1X2, selection: "AWAY", line: undefined, probability: probability1x2.away },
  ];
}

/** P(1X) = P(Home) + P(Draw), P(X2) = P(Draw) + P(Away), P(12) = P(Home) + P(Away) — Section 07 §6's exact formulas. Always derivable from 1X2 alone; never independently modeled or fabricated. */
function mapDoubleChance(probability1x2: Probability1x2): readonly MarketProbabilityResult[] {
  return [
    { marketType: MarketType.DOUBLE_CHANCE, selection: "1X", line: undefined, probability: probability1x2.home + probability1x2.draw },
    { marketType: MarketType.DOUBLE_CHANCE, selection: "X2", line: undefined, probability: probability1x2.draw + probability1x2.away },
    { marketType: MarketType.DOUBLE_CHANCE, selection: "12", line: undefined, probability: probability1x2.home + probability1x2.away },
  ];
}

function mapBtts(btts: BinaryProbability): readonly MarketProbabilityResult[] {
  return [
    { marketType: MarketType.BOTH_TEAMS_TO_SCORE, selection: "YES", line: undefined, probability: btts.yes },
    { marketType: MarketType.BOTH_TEAMS_TO_SCORE, selection: "NO", line: undefined, probability: btts.no },
  ];
}

function mapOverUnder(overUnder: BinaryProbability, line: number): readonly MarketProbabilityResult[] {
  return [
    { marketType: MarketType.OVER_UNDER, selection: "OVER", line, probability: overUnder.yes },
    { marketType: MarketType.OVER_UNDER, selection: "UNDER", line, probability: overUnder.no },
  ];
}

/** One selection per (homeGoals, awayGoals) pair the distribution assigned mass to — selection string format `"{homeGoals}-{awayGoals}"` (e.g. `"2-1"`), matching the convention `monte-carlo.ts` itself uses internally. */
function mapCorrectScore(distribution: ScorelineDistribution): readonly MarketProbabilityResult[] {
  return distribution.map((s) => ({ marketType: MarketType.CORRECT_SCORE, selection: `${s.homeGoals}-${s.awayGoals}`, line: undefined, probability: s.probability }));
}

const UNSUPPORTED_MARKETS: ReadonlySet<MarketType> = new Set([MarketType.TEAM_TOTALS, MarketType.ASIAN_HANDICAP, MarketType.EUROPEAN_HANDICAP, MarketType.CORNERS, MarketType.CARDS, MarketType.FIRST_HALF, MarketType.SECOND_HALF]);

/**
 * Maps to ONE requested market type. `line` is required for
 * `OVER_UNDER` (selects which threshold from `inputs.overUnder`) and
 * ignored otherwise.
 */
export function mapProbabilityToMarket(inputs: ProbabilityInputs, marketType: MarketType, line?: number): MarketMappingResult {
  if (UNSUPPORTED_MARKETS.has(marketType)) {
    return { ok: false, reason: "MARKET_UNSUPPORTED", marketType, detail: `No model in this codebase computes a probability for ${marketType} yet.` };
  }
  switch (marketType) {
    case MarketType.MATCH_RESULT_1X2:
      return { ok: true, markets: map1x2(inputs.probability1x2) };
    case MarketType.DOUBLE_CHANCE:
      return { ok: true, markets: mapDoubleChance(inputs.probability1x2) };
    case MarketType.BOTH_TEAMS_TO_SCORE:
      if (!inputs.btts) return { ok: false, reason: "MARKET_UNSUPPORTED", marketType, detail: "No BTTS probability was supplied for this prediction." };
      return { ok: true, markets: mapBtts(inputs.btts) };
    case MarketType.OVER_UNDER: {
      const key = line !== undefined ? String(line) : undefined;
      const entry = key !== undefined ? inputs.overUnder?.[key] : undefined;
      if (!entry) return { ok: false, reason: "MARKET_UNSUPPORTED", marketType, detail: `No Over/Under probability was supplied for line ${line ?? "(none specified)"}.` };
      return { ok: true, markets: mapOverUnder(entry, line!) };
    }
    case MarketType.CORRECT_SCORE:
      if (!inputs.correctScoreDistribution) return { ok: false, reason: "MARKET_UNSUPPORTED", marketType, detail: "No correct-score distribution was supplied for this prediction." };
      return { ok: true, markets: mapCorrectScore(inputs.correctScoreDistribution) };
    default:
      return { ok: false, reason: "MARKET_UNSUPPORTED", marketType, detail: `No model in this codebase computes a probability for ${marketType} yet.` };
  }
}

/** Every market this codebase can currently derive from `inputs`, given whatever optional fields are actually present — 1X2/Double Chance always, BTTS/Over-Under(-per-threshold)/Correct Score only when their source data was supplied. */
export function mapAllSupportedMarkets(inputs: ProbabilityInputs): readonly MarketProbabilityResult[] {
  const markets: MarketProbabilityResult[] = [...map1x2(inputs.probability1x2), ...mapDoubleChance(inputs.probability1x2)];
  if (inputs.btts) markets.push(...mapBtts(inputs.btts));
  if (inputs.overUnder) {
    for (const [key, value] of Object.entries(inputs.overUnder)) {
      markets.push(...mapOverUnder(value, Number(key)));
    }
  }
  if (inputs.correctScoreDistribution) markets.push(...mapCorrectScore(inputs.correctScoreDistribution));
  return markets;
}
