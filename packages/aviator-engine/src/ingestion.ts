import type { ISODateString } from "@sport-os/shared";

/**
 * Data Ingestion boundary (Section 01 — Aviator Engine Boundary). Adapts
 * an external Aviator round-history data provider into normalized
 * shapes. No provider integration is implemented in Section 01.
 */
export interface AviatorRoundRecord {
  readonly roundId: string;
  readonly multiplier: number | null;
  readonly occurredAt: ISODateString;
}

export interface AviatorDataIngestion {
  ingestRounds(since: ISODateString): Promise<readonly AviatorRoundRecord[]>;
}
