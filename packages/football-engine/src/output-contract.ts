import { ValidationError, err, ok, type ISODateString, type Result, type UUID } from "@sport-os/shared";
import type { FeatureQuality } from "./features/types.js";
import { checkProbability1x2 } from "./probability/consistency.js";
import type { Probability1x2 } from "./probability/types.js";

/**
 * Prediction Output Contract — Section 05 §19-20. The one shape later
 * sections (Section 07's decision/risk/execution boundary) are told to
 * consume. Nothing that constructs a PredictionOutput may claim
 * certainty: no "sure"/"guaranteed"/"banker"/equivalent language
 * anywhere in this module or its callers, and `probability` and
 * `confidence` are never used interchangeably — see `uncertainty`,
 * which is explicitly named apart from `probability` for exactly this
 * reason. A PredictionOutput is a statistical estimate with documented
 * provenance, never a promise.
 */

export interface MarketProbability {
  readonly market: string;
  readonly selection: string;
  readonly probability: number;
  /** 1 / probability — undefined only when probability is exactly 0 (fair odds is undefined, not Infinity, for a zero-probability outcome). Never a bookmaker price; see computeFairOdds's own comment. */
  readonly fairOdds: number | undefined;
}

export interface PredictionUncertainty {
  /** Monte Carlo sampling standard error on the home-win probability, when this prediction was built from a Monte Carlo simulation — undefined otherwise. This is a SAMPLING uncertainty measure (how much the estimate would vary by re-running the simulation), not a statement about real-world confidence — the two are not interchangeable. */
  readonly monteCarloStandardError: number | undefined;
  readonly note: "This output is a statistical probability estimate, not a guarantee. See docs/architecture/FOOTBALL_INTELLIGENCE.md.";
}

export interface PredictionProvenance {
  readonly sourceVersion: string;
  /** Present only when this prediction came from an ensemble — which named components contributed and at what effective (post-renormalization) weight. See ensemble.ts's EnsembleOutput.componentContributions. */
  readonly componentContributions: Readonly<Record<string, { readonly modelVersion: string; readonly effectiveWeight: number }>> | undefined;
}

export interface PredictionOutput {
  readonly fixtureId: UUID;
  readonly predictionTimestamp: ISODateString;
  readonly snapshotTime: ISODateString;
  readonly modelVersion: string;
  readonly ensembleVersion: string | undefined;
  readonly calibrationVersion: string | undefined;
  readonly dataQuality: FeatureQuality;
  readonly homeWinProbability: number;
  readonly drawProbability: number;
  readonly awayWinProbability: number;
  /** Every market this prediction covers, including 1X2 (as HOME/DRAW/AWAY selections) and any additional supported market (BTTS, Over/Under) — extensible without a shape change. */
  readonly markets: readonly MarketProbability[];
  /** featureId -> featureVersion actually used to build this prediction — the exact reproducibility anchor (see features/types.ts's FeatureDefinition.version). */
  readonly featureVersions: Readonly<Record<string, number>>;
  readonly uncertainty: PredictionUncertainty;
  readonly provenance: PredictionProvenance;
}

/** fairOdds = 1 / probability, only for probability > 0. This is NOT a bookmaker price and must never be presented as one — see docs/architecture/FOOTBALL_INTELLIGENCE.md's odds-features capability row and Section 05 §20's explicit warning not to confuse the two. */
export function computeFairOdds(probability: number): number | undefined {
  if (!(probability > 0)) return undefined;
  return 1 / probability;
}

export interface AdditionalMarketInput {
  readonly market: string;
  readonly selection: string;
  readonly probability: number;
}

export interface BuildPredictionOutputParams {
  readonly fixtureId: UUID;
  readonly predictionTimestamp: ISODateString;
  readonly snapshotTime: ISODateString;
  readonly modelVersion: string;
  readonly ensembleVersion?: string;
  readonly calibrationVersion?: string;
  readonly probability1x2: Probability1x2;
  readonly additionalMarkets?: readonly AdditionalMarketInput[];
  readonly dataQuality: FeatureQuality;
  readonly featureVersions: Readonly<Record<string, number>>;
  readonly sourceVersion: string;
  readonly componentContributions?: Readonly<Record<string, { readonly modelVersion: string; readonly effectiveWeight: number }>>;
  readonly monteCarloStandardError?: number;
}

/** Fails closed (never constructs an output around an invalid probability distribution) via probability/consistency.ts — the same check every other model output passes through. */
export function buildPredictionOutput(params: BuildPredictionOutputParams): Result<PredictionOutput, ValidationError> {
  const check = checkProbability1x2(params.probability1x2);
  if (!check.ok) return err(check.error);

  for (const m of params.additionalMarkets ?? []) {
    if (!Number.isFinite(m.probability) || m.probability < 0 || m.probability > 1) {
      return err(new ValidationError({ message: `Market '${m.market}' selection '${m.selection}' has an invalid probability.`, code: "PREDICTION_OUTPUT_INVALID_MARKET", context: { market: m.market, selection: m.selection, probability: m.probability } }));
    }
  }

  const markets: MarketProbability[] = [
    { market: "1X2", selection: "HOME", probability: params.probability1x2.home, fairOdds: computeFairOdds(params.probability1x2.home) },
    { market: "1X2", selection: "DRAW", probability: params.probability1x2.draw, fairOdds: computeFairOdds(params.probability1x2.draw) },
    { market: "1X2", selection: "AWAY", probability: params.probability1x2.away, fairOdds: computeFairOdds(params.probability1x2.away) },
    ...(params.additionalMarkets ?? []).map((m) => ({ market: m.market, selection: m.selection, probability: m.probability, fairOdds: computeFairOdds(m.probability) })),
  ];

  return ok({
    fixtureId: params.fixtureId,
    predictionTimestamp: params.predictionTimestamp,
    snapshotTime: params.snapshotTime,
    modelVersion: params.modelVersion,
    ensembleVersion: params.ensembleVersion,
    calibrationVersion: params.calibrationVersion,
    dataQuality: params.dataQuality,
    homeWinProbability: params.probability1x2.home,
    drawProbability: params.probability1x2.draw,
    awayWinProbability: params.probability1x2.away,
    markets,
    featureVersions: params.featureVersions,
    uncertainty: { monteCarloStandardError: params.monteCarloStandardError, note: "This output is a statistical probability estimate, not a guarantee. See docs/architecture/FOOTBALL_INTELLIGENCE.md." },
    provenance: { sourceVersion: params.sourceVersion, componentContributions: params.componentContributions },
  });
}
