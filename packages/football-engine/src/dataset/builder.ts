import type { ISODateString } from "@sport-os/shared";
import type { Fixture, MatchResult } from "../canonical.js";
import { computePreMatchSnapshotTime } from "../leakage-guard.js";
import { computeFeatureVector, type FeatureRegistryDependencies } from "../features/index.js";
import { Target1X2, type TrainingDataset, type TrainingExample } from "./types.js";

/**
 * Training Dataset Builder — Section 05 §7. Reuses
 * leakage-guard.ts's computePreMatchSnapshotTime for the same reason
 * Section 04 built it: "the caller must explicitly supply
 * snapshot_time... do not hard-code one universal lead time."
 *
 * The label is derived from the fixture's REAL, final MatchResult
 * (labels are always allowed to see the future — that is what makes
 * them labels), while every feature is computed at `snapshotTime`,
 * strictly before kickoff. This split — label from the full outcome,
 * features from a strictly-earlier snapshot — is the one place in this
 * pipeline where "future information" is used on purpose and is not
 * leakage: leakage would only occur if a FEATURE could see it too,
 * which features/registry.ts's snapshotTime gate already prevents.
 */

export interface BuildDatasetDependencies extends FeatureRegistryDependencies {
  readonly matchResults: FeatureRegistryDependencies["matchResults"];
}

export interface BuildTrainingDatasetParams {
  readonly fixtures: readonly Fixture[];
  /** Minutes before kickoff the snapshot is taken — never defaulted, per computePreMatchSnapshotTime's own contract. */
  readonly snapshotLeadTimeMinutes: number;
  readonly datasetVersion: string;
  readonly sourceVersion: string;
  readonly now?: () => ISODateString;
}

function derive1x2(result: MatchResult): Target1X2 {
  if (result.homeGoals > result.awayGoals) return Target1X2.HOME;
  if (result.homeGoals < result.awayGoals) return Target1X2.AWAY;
  return Target1X2.DRAW;
}

function deriveBtts(result: MatchResult): boolean {
  return result.homeGoals > 0 && result.awayGoals > 0;
}

export async function buildTrainingDataset(deps: BuildDatasetDependencies, params: BuildTrainingDatasetParams): Promise<TrainingDataset> {
  const now = (params.now ?? (() => new Date().toISOString()))();
  const examples: TrainingExample[] = [];
  const excluded: { fixtureId: string; reason: string }[] = [];

  for (const fixture of params.fixtures) {
    const result = await deps.matchResults.getByFixtureId(fixture.id);
    if (!result) {
      excluded.push({ fixtureId: fixture.id, reason: "No match result exists for this fixture — cannot derive a label." });
      continue;
    }

    const snapshotTime = computePreMatchSnapshotTime(fixture, params.snapshotLeadTimeMinutes);
    const kickoffMs = new Date(fixture.scheduledKickoffAt).getTime();
    const snapshotMs = new Date(snapshotTime).getTime();
    if (snapshotMs >= kickoffMs) {
      // computePreMatchSnapshotTime should never produce this for a
      // positive lead time, but a training example built from a
      // snapshot at or after kickoff would be a direct TARGET_LEAKAGE
      // risk (the snapshot could then legitimately see live/post-match
      // data) — reject it outright rather than silently including it.
      excluded.push({ fixtureId: fixture.id, reason: "snapshotTime is not strictly before kickoff — refusing to build a training example (target-leakage risk)." });
      continue;
    }

    const features = await computeFeatureVector({ fixtureId: fixture.id, snapshotTime, now }, deps, fixture, params.sourceVersion);

    examples.push({
      fixtureId: fixture.id,
      competitionId: fixture.competitionId,
      seasonId: fixture.seasonId,
      kickoffTime: fixture.scheduledKickoffAt,
      snapshotTime,
      features,
      target1x2: derive1x2(result),
      targetTotalGoals: result.homeGoals + result.awayGoals,
      targetBtts: deriveBtts(result),
      datasetVersion: params.datasetVersion,
      builtAt: now,
    });
  }

  // Chronological order is an invariant of this dataset, not an
  // incidental property of iteration order — walk-forward validation
  // depends on it and must never need to re-sort or, worse, shuffle.
  examples.sort((a, b) => new Date(a.kickoffTime).getTime() - new Date(b.kickoffTime).getTime());

  return { datasetVersion: params.datasetVersion, builtAt: now, examples, excluded };
}
