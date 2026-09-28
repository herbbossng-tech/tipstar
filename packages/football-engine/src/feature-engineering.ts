import { ValidationError, type ISODateString, type UUID } from "@sport-os/shared";
import { computeFeatureVector, type FeatureRegistryDependencies, type FeatureVector } from "./features/index.js";

/**
 * Feature Engineering boundary (Section 05 — supersedes the Section 01
 * placeholder, which fixed only `buildFeatures(eventId, asOf)` returning
 * an untyped `Record<string, number | null>`, with no computation
 * behind it and no notion of feature identity/versioning). The real
 * feature architecture lives in features/ — this is the thin,
 * fixture/UUID-typed facade over features/registry.ts's
 * computeFeatureVector(), the single entry point every feature family
 * is computed through.
 *
 * Every feature is computable from information genuinely available
 * `asOf` (here: `snapshotTime`) — see
 * docs/data/DATA_LEAKAGE_PRINCIPLE.md and
 * docs/architecture/LEAKAGE_PROTECTION.md.
 */
export interface FootballFeatureEngineer {
  buildFeatures(fixtureId: UUID, snapshotTime: ISODateString): Promise<FeatureVector>;
}

export class DefaultFootballFeatureEngineer implements FootballFeatureEngineer {
  constructor(
    private readonly deps: FeatureRegistryDependencies,
    /** "test_fixture_provider" for the deterministic synthetic dataset, or a real provider's name once one is connected — see FeatureValue.sourceVersion. */
    private readonly sourceVersion: string,
    /** Injected for deterministic tests — defaults to the real clock in production use. */
    private readonly now: () => ISODateString = () => new Date().toISOString(),
  ) {}

  async buildFeatures(fixtureId: UUID, snapshotTime: ISODateString): Promise<FeatureVector> {
    const fixture = await this.deps.fixtures.getById(fixtureId);
    if (!fixture) {
      throw new ValidationError({ message: "Fixture not found.", code: "FIXTURE_NOT_FOUND", context: { fixtureId } });
    }
    return computeFeatureVector({ fixtureId, snapshotTime, now: this.now() }, this.deps, fixture, this.sourceVersion);
  }
}
