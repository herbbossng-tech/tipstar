import type { ISODateString } from "@sport-os/shared";

/**
 * Feature Engineering boundary (Section 01 — Football Engine Boundary).
 * Every feature must be computable from information genuinely available
 * `asOf` the given timestamp — see docs/data/DATA_LEAKAGE_PRINCIPLE.md.
 * No feature computation is implemented in Section 01.
 */
export interface FootballFeatureEngineer {
  buildFeatures(eventId: string, asOf: ISODateString): Promise<Readonly<Record<string, number | null>>>;
}
