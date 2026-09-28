/**
 * Data Quality boundary (Section 01 — Football Engine Boundary). Validates
 * and flags ingested records before they reach feature engineering —
 * never silently repairs data by guessing a value.
 */
export interface DataQualityIssue {
  readonly field: string;
  readonly reason: string;
}

export interface FootballDataQualityCheck {
  check(record: Readonly<Record<string, unknown>>): Promise<{ readonly valid: boolean; readonly issues: readonly DataQualityIssue[] }>;
}
