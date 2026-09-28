import type { Fixture } from "../canonical.js";
import type { FixturesRepository, MatchResultsRepository } from "../repositories/fixtures.js";
import type { OddsObservationsRepository } from "../repositories/observations.js";
import { ELO_FEATURE_DEFINITIONS, computeEloFeatures } from "./elo.js";
import { FORM_FEATURE_DEFINITIONS, computeFormFeatures } from "./form.js";
import { REST_SCHEDULE_FEATURE_DEFINITIONS, computeRestScheduleFeatures } from "./rest-schedule.js";
import { HOME_AWAY_FEATURE_DEFINITIONS, computeHomeAwayFeatures } from "./home-away.js";
import { H2H_FEATURE_DEFINITIONS, computeH2hFeatures } from "./h2h.js";
import { ODDS_FEATURE_DEFINITIONS, computeOddsFeatures } from "./odds.js";
import { UNAVAILABLE_FEATURE_DEFINITIONS, computeUnavailableFeatures } from "./unavailable.js";
import type { FeatureComputationContext, FeatureDefinition, FeatureVector } from "./types.js";

/**
 * The Feature Store's computation surface: every FeatureDefinition this
 * section knows about (enabled and disabled alike — see
 * FeatureDefinition.enabled), and the one entry point
 * (computeFeatureVector) that produces a full, versioned FeatureVector
 * for one fixture at one snapshot by calling every enabled family and
 * folding the disabled ones in as explicit MISSING values.
 *
 * Deliberately NOT a persisted feature matrix — see feature-store.ts's
 * module comment for why. Every FeatureVector is reproducible from this
 * registry plus Section 04's stored data alone.
 */
export const ALL_FEATURE_DEFINITIONS: readonly FeatureDefinition[] = [
  ...ELO_FEATURE_DEFINITIONS,
  ...FORM_FEATURE_DEFINITIONS,
  ...REST_SCHEDULE_FEATURE_DEFINITIONS,
  ...HOME_AWAY_FEATURE_DEFINITIONS,
  ...H2H_FEATURE_DEFINITIONS,
  ...ODDS_FEATURE_DEFINITIONS,
  ...UNAVAILABLE_FEATURE_DEFINITIONS,
];

export interface FeatureRegistryDependencies {
  readonly fixtures: FixturesRepository;
  readonly matchResults: MatchResultsRepository;
  readonly oddsObservations: OddsObservationsRepository;
}

export async function computeFeatureVector(ctx: FeatureComputationContext, deps: FeatureRegistryDependencies, fixture: Fixture, sourceVersion: string): Promise<FeatureVector> {
  const [elo, form, rest, homeAway, h2h, odds] = await Promise.all([
    computeEloFeatures(ctx, deps, fixture, sourceVersion),
    computeFormFeatures(ctx, deps, fixture, sourceVersion),
    computeRestScheduleFeatures(ctx, deps, fixture, sourceVersion),
    computeHomeAwayFeatures(ctx, deps, fixture, sourceVersion),
    computeH2hFeatures(ctx, deps, fixture, sourceVersion),
    computeOddsFeatures(ctx, deps, fixture, sourceVersion),
  ]);
  const unavailable = computeUnavailableFeatures(ctx, fixture, sourceVersion);

  const vector: Record<string, (typeof elo)[number]> = {};
  for (const value of [...elo, ...form, ...rest, ...homeAway, ...h2h, ...odds, ...unavailable]) {
    vector[value.featureId] = value;
  }
  return vector;
}
