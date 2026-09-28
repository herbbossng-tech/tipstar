import type { ISODateString, UUID } from "@sport-os/shared";
import type { FeatureVector } from "../features/types.js";

/**
 * Training dataset types (Section 05 §7 — Training Dataset Builder).
 * Every TrainingExample is fully reproducible: recomputing features for
 * the same (fixtureId, snapshotTime) via features/registry.ts and
 * re-deriving the label from the same MatchResult always yields the
 * same example — nothing here is randomly generated.
 */

export const Target1X2 = { HOME: "HOME", DRAW: "DRAW", AWAY: "AWAY" } as const;
export type Target1X2 = (typeof Target1X2)[keyof typeof Target1X2];

/**
 * A training example's label set. Only 1X2, total goals, and BTTS are
 * populated this section — the spec explicitly says "Do not build every
 * market just because the architecture mentions them. Prioritize: 1X2,
 * total goals, BTTS" and to make the architecture "extensible for later
 * markets" rather than build them all now. Adding a market later means
 * adding a field here plus a `derive*` function in builder.ts, not a
 * redesign.
 */
export interface TrainingExample {
  readonly fixtureId: UUID;
  readonly competitionId: UUID;
  readonly seasonId: UUID | undefined;
  readonly kickoffTime: ISODateString;
  readonly snapshotTime: ISODateString;
  readonly features: FeatureVector;
  readonly target1x2: Target1X2;
  /** Actual total goals scored — the raw number a later over/under threshold is applied to, rather than baking one threshold in here. */
  readonly targetTotalGoals: number;
  readonly targetBtts: boolean;
  readonly datasetVersion: string;
  readonly builtAt: ISODateString;
}

export interface TrainingDataset {
  readonly datasetVersion: string;
  readonly builtAt: ISODateString;
  readonly examples: readonly TrainingExample[];
  /** Fixtures that were considered but excluded (no match result, or snapshotTime validation failed), with the reason — dataset construction never silently drops examples. */
  readonly excluded: readonly { readonly fixtureId: UUID; readonly reason: string }[];
}
