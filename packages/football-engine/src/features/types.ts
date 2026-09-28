import type { ISODateString, UUID } from "@sport-os/shared";

/**
 * Feature architecture core types (Section 05 — Feature Store
 * Architecture). Separates Feature Definition (what a feature IS and
 * how it's versioned) from Feature Value (one computed number for one
 * fixture at one snapshot). Every FeatureValue must be reproducible:
 * the same (featureId, featureVersion, fixtureId, snapshotTime) must
 * always recompute to the same value, because nothing here is
 * persisted as a bulk matrix — see the module comment in
 * ../feature-store.ts for why.
 */

export const FeatureQuality = {
  /** A real value, computed from genuinely available data. */
  AVAILABLE: "AVAILABLE",
  /** No underlying data exists to compute this feature at all (e.g. an unavailable capability, or a team with zero prior history). Never silently replaced with 0. */
  MISSING: "MISSING",
  /** Data exists but is older than the feature's own freshness expectation. */
  STALE: "STALE",
  /** The underlying data failed a Section 04 quality/leakage check and was excluded. */
  INVALID: "INVALID",
  /** Computed from the deterministic synthetic test-fixture provider — never to be read as real-world signal. */
  SYNTHETIC: "SYNTHETIC",
  /** A real value, but based on too little history/observations to be trusted at full weight (e.g. H2H with 1 prior meeting). */
  LOW_CONFIDENCE: "LOW_CONFIDENCE",
} as const;
export type FeatureQuality = (typeof FeatureQuality)[keyof typeof FeatureQuality];

export const FeatureFamily = {
  TEAM_STRENGTH: "team_strength",
  FORM: "form",
  REST_SCHEDULE: "rest_schedule",
  HOME_AWAY: "home_away",
  GOALS: "goals",
  HEAD_TO_HEAD: "head_to_head",
  ODDS: "odds",
  XG: "xg",
  TEAM_STATISTICS: "team_statistics",
  STANDINGS: "standings",
} as const;
export type FeatureFamily = (typeof FeatureFamily)[keyof typeof FeatureFamily];

/**
 * A feature's stable identity/version (spec: "A feature must have a
 * stable identity/version"). `version` increments whenever the
 * computation logic changes in a way that could change output for the
 * same inputs — never reused for a different formula.
 */
export interface FeatureDefinition {
  readonly featureId: string;
  readonly name: string;
  readonly version: number;
  readonly description: string;
  readonly family: FeatureFamily;
  /** Section 04 entities this feature reads — documents the leakage surface, not enforced by the type system. */
  readonly dataDependencies: readonly string[];
  /** Human-readable window description (e.g. "last 5 matches", "full history", "n/a"). */
  readonly lookback: string;
  /** The point-in-time rule this feature follows, stated explicitly rather than left implicit. */
  readonly computationTimestampRule: string;
  readonly availabilityRequirement: string;
  readonly missingValuePolicy: string;
  readonly leakageRisk: "none" | "low" | "medium" | "high";
  /** false for features whose underlying canonical data does not exist yet (xG, team statistics, standings) — declared for a stable name/shape, never computed. */
  readonly enabled: boolean;
}

export interface FeatureValue {
  readonly featureId: string;
  readonly featureVersion: number;
  readonly fixtureId: UUID;
  /** null exactly when dataQuality is MISSING or INVALID — never a fabricated 0. */
  readonly value: number | null;
  readonly computedAt: ISODateString;
  readonly snapshotTime: ISODateString;
  readonly dataQuality: FeatureQuality;
  /** "test_fixture_provider" for the deterministic synthetic dataset, or a real provider's name once one is connected. */
  readonly sourceVersion: string;
}

/** All FeatureValues computed for one fixture at one snapshot, keyed by featureId. */
export type FeatureVector = Readonly<Record<string, FeatureValue>>;

export interface FeatureComputationContext {
  readonly fixtureId: UUID;
  readonly snapshotTime: ISODateString;
  /** Injected rather than read from Date.now() so computation is deterministic and testable — see FeatureValue.computedAt. */
  readonly now: ISODateString;
}

export function missingFeatureValue(featureId: string, featureVersion: number, fixtureId: UUID, snapshotTime: ISODateString, now: ISODateString, sourceVersion: string): FeatureValue {
  return { featureId, featureVersion, fixtureId, value: null, computedAt: now, snapshotTime, dataQuality: FeatureQuality.MISSING, sourceVersion };
}
