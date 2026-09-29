import { ALL_FEATURE_DEFINITIONS } from "./features/index.js";
import type { FeatureDefinition } from "./features/index.js";

/**
 * Feature Store (Section 05 — supersedes the Section 01 placeholder,
 * which fixed a `get(eventId)`/`put(eventId, features)` cache
 * interface with no implementation).
 *
 * Deliberate design decision: this section does NOT persist a bulk
 * feature-value matrix. The spec is explicit — "Do not persist
 * enormous redundant feature matrices if the architecture does not
 * require them. Prefer reproducibility through: immutable dataset/
 * version references, feature definitions, source snapshot timestamps,
 * deterministic computation." Every FeatureValue is cheap and
 * deterministic to recompute from Section 04's stored data plus a
 * FeatureDefinition's version — recomputing on demand (see
 * feature-engineering.ts's DefaultFootballFeatureEngineer) is simpler,
 * always-consistent, and never goes stale relative to its own
 * definition, so there is nothing a cache would buy that isn't already
 * free.
 *
 * What this module actually is: the "store" for FeatureDefinitions
 * themselves — a stable, versioned catalog every consumer (training
 * dataset builder, model, documentation) reads from. Definitions live
 * in code (features/*.ts), not a database table — see
 * docs/architecture/FOOTBALL_INTELLIGENCE.md's "Database / Persistence"
 * section for why definitions specifically don't need DB storage, in
 * contrast with dataset/model/training-run/evaluation-run/calibration
 * versions, which do (see repositories/intelligence.ts).
 */
export function listFeatureDefinitions(): readonly FeatureDefinition[] {
  return ALL_FEATURE_DEFINITIONS;
}

export function getFeatureDefinition(featureId: string): FeatureDefinition | undefined {
  return ALL_FEATURE_DEFINITIONS.find((d) => d.featureId === featureId);
}
