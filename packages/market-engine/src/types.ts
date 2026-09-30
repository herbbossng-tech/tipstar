import type { ISODateString, UUID } from "@sport-os/shared";

/**
 * The locked football markets (Section 07 §5). Additive to Section 01's
 * original 4 values — `MATCH_RESULT_1X2`/`OVER_UNDER`/
 * `BOTH_TEAMS_TO_SCORE`/`DOUBLE_CHANCE` keep their exact original string
 * values (existing callers — `@sport-os/agents`' Football Decision
 * Agent, its tests — are unaffected). Declaring a market here does NOT
 * mean this codebase can compute a real probability for it: see
 * `@sport-os/football-engine`'s `market-mapping.ts`, which explicitly
 * returns `MARKET_UNSUPPORTED` for any of these no underlying model
 * (Elo/Poisson/Dixon-Coles/Monte Carlo) actually produces a probability
 * for — `TEAM_TOTALS`/`ASIAN_HANDICAP`/`EUROPEAN_HANDICAP`/`CORNERS`/
 * `CARDS`/`FIRST_HALF`/`SECOND_HALF` are declared here for a complete
 * canonical representation, never fabricated a value.
 */
export const MarketType = {
  MATCH_RESULT_1X2: "match_result_1x2",
  OVER_UNDER: "over_under",
  BOTH_TEAMS_TO_SCORE: "both_teams_to_score",
  DOUBLE_CHANCE: "double_chance",
  TEAM_TOTALS: "team_totals",
  ASIAN_HANDICAP: "asian_handicap",
  EUROPEAN_HANDICAP: "european_handicap",
  CORNERS: "corners",
  CARDS: "cards",
  CORRECT_SCORE: "correct_score",
  FIRST_HALF: "first_half",
  SECOND_HALF: "second_half",
} as const;
export type MarketType = (typeof MarketType)[keyof typeof MarketType];

/** A single provider-sourced odds observation (Section 01 original — unchanged). Never fabricated — a provider gap is `null`, not a guess. */
export interface OddsSnapshot {
  readonly eventId: string;
  readonly marketType: MarketType;
  readonly selection: string;
  readonly odds: number | null;
  readonly providerId: string;
  readonly observedAt: ISODateString;
}

/** Whether a market is currently open for a real wager (Section 07 §36 — "if provider reports a market as suspended/cancelled: do not create a valid execution request"). */
export const MarketStatus = {
  OPEN: "open",
  SUSPENDED: "suspended",
  CANCELLED: "cancelled",
} as const;
export type MarketStatus = (typeof MarketStatus)[keyof typeof MarketStatus];

/** The current schema version of `MarketObservation` — bump when its shape changes in a way older readers can't safely ignore. */
export const MARKET_OBSERVATION_SCHEMA_VERSION = 1;

/**
 * The canonical market representation (Section 07 §5). One row per
 * (fixture, market, selection, line) sighting from one source, at one
 * moment — append-only in spirit, the same "never rewrite a historical
 * observation" rule Section 04's `fixture_status_observations`/
 * `match_results` versions established: a later odds movement is a NEW
 * `MarketObservation`, never an edit to this one.
 */
export interface MarketObservation {
  readonly marketId: UUID;
  readonly marketType: MarketType;
  readonly fixtureId: UUID;
  readonly selection: string;
  /** The line/handicap/total this selection is quoted against (e.g. 2.5 for an Over/Under selection, -1 for an Asian Handicap selection) — undefined for line-less markets (1X2, BTTS). */
  readonly line: number | undefined;
  /** `null` when the source reported no price (e.g. the market is suspended) — never coerced to 0 or omitted, so "no odds" and "odds are exactly 0" (impossible for real decimal odds, but never silently conflated) stay distinguishable. */
  readonly odds: number | null;
  readonly oddsTimestamp: ISODateString;
  readonly source: string;
  /** The source's own identifier for this specific sighting, when it provides one — for provenance/dedup, mirroring Section 04's `providerFixtureId` pattern. */
  readonly sourceObservationId: string | undefined;
  readonly status: MarketStatus;
  readonly schemaVersion: number;
}

export interface NewMarketObservationInput {
  readonly marketType: MarketType;
  readonly fixtureId: UUID;
  readonly selection: string;
  readonly line?: number;
  readonly odds: number | null;
  readonly oddsTimestamp: ISODateString;
  readonly source: string;
  readonly sourceObservationId?: string;
  readonly status: MarketStatus;
}

/**
 * decimal odds -> implied probability, the mechanical inverse of
 * `computeFairOdds` below. Returns `undefined` for odds that cannot
 * represent a real, offered price (`odds` is `null`, `<= 1`, or
 * non-finite) — never a fabricated probability for missing/invalid odds.
 */
export function computeImpliedProbability(odds: number | null): number | undefined {
  if (odds === null || !Number.isFinite(odds) || odds <= 1) return undefined;
  return 1 / odds;
}

/**
 * probability -> fair (model-implied) decimal odds — Section 07 §7:
 * "fair_odds = 1 / probability... Fair odds are model-derived. They are
 * NOT bookmaker odds" (no margin is ever added here). Intentionally the
 * same one-line formula `football-engine/output-contract.ts`'s
 * `computeFairOdds` already implements — duplicated rather than
 * imported because `market-engine` cannot depend on `football-engine`
 * (the dependency runs the other way: `football-engine` depends on
 * `market-engine`), and this is genuinely sport/market-domain math, not
 * football-specific. Rounded to 4 decimal places — explicit, documented,
 * deterministic; never left to floating-point display precision.
 */
export function computeFairOdds(probability: number): number | undefined {
  if (!(probability > 0) || !Number.isFinite(probability)) return undefined;
  return Math.round((1 / probability) * 10000) / 10000;
}

/**
 * The overround/margin a set of mutually exclusive selections' quoted
 * odds imply (Section 07 §11) — sum of implied probabilities, which
 * exceeds 1 by the bookmaker's margin for any real market. This
 * function ONLY measures the overround; it never removes it (no
 * de-vigging) — see the module doc comment on why that stays a
 * deliberately unimplemented, explicit future extension point.
 */
export function computeMarketOverround(oddsBySelection: readonly (number | null)[]): number | undefined {
  const impliedProbabilities = oddsBySelection.map(computeImpliedProbability);
  if (impliedProbabilities.some((p) => p === undefined)) return undefined;
  return (impliedProbabilities as readonly number[]).reduce((sum, p) => sum + p, 0);
}

export interface OddsValidityConfig {
  /** Section 07 §35: "Odds must have an explicit freshness policy... do not hard-code an arbitrary value without documenting it." No default is provided by this module — every caller must supply one explicitly. A commonly reasonable value for a fast-moving pre-match market is 120 seconds; this is a suggestion documented here, never silently applied. */
  readonly maxOddsAgeSeconds: number;
}

export type OddsValidityFailureReason = "MISSING_ODDS" | "NON_POSITIVE_ODDS" | "NON_FINITE_ODDS" | "STALE_ODDS" | "FUTURE_TIMESTAMP" | "MARKET_SUSPENDED" | "MARKET_CANCELLED";

export type OddsValidityResult = { readonly valid: true } | { readonly valid: false; readonly reason: OddsValidityFailureReason };

/**
 * Every odds-validity check Section 07 §10 requires, in one place, so
 * the Value Engine (`football-engine/decision.ts`) never re-derives its
 * own subset. `evaluationTime` is the caller's own snapshot/"now" — kept
 * explicit and injected (never `new Date()` inside this pure function)
 * so evaluation is deterministic and testable.
 */
export function checkOddsValidity(observation: Pick<MarketObservation, "odds" | "oddsTimestamp" | "status">, evaluationTime: ISODateString, config: OddsValidityConfig): OddsValidityResult {
  if (observation.status === MarketStatus.SUSPENDED) return { valid: false, reason: "MARKET_SUSPENDED" };
  if (observation.status === MarketStatus.CANCELLED) return { valid: false, reason: "MARKET_CANCELLED" };
  if (observation.odds === null) return { valid: false, reason: "MISSING_ODDS" };
  if (!Number.isFinite(observation.odds)) return { valid: false, reason: "NON_FINITE_ODDS" };
  if (observation.odds <= 1) return { valid: false, reason: "NON_POSITIVE_ODDS" };

  const observedMs = new Date(observation.oddsTimestamp).getTime();
  const evaluationMs = new Date(evaluationTime).getTime();
  if (observedMs > evaluationMs) return { valid: false, reason: "FUTURE_TIMESTAMP" };
  const ageSeconds = (evaluationMs - observedMs) / 1000;
  if (ageSeconds > config.maxOddsAgeSeconds) return { valid: false, reason: "STALE_ODDS" };

  return { valid: true };
}
