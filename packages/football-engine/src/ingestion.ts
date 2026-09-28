import type { ISODateString } from "@sport-os/shared";

/**
 * Data Ingestion boundary (Section 01 — Football Engine Boundary). Adapts
 * an external football data provider into normalized shapes. A provider
 * gap must surface as `null`, never a fabricated value. No provider
 * integration is implemented in Section 01.
 */
export interface FootballDataIngestion {
  ingestFixtures(since: ISODateString): Promise<unknown>;
  ingestResults(since: ISODateString): Promise<unknown>;
}
