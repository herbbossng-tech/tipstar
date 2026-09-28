/**
 * Expected Goals (xG) model boundary (Section 01 — Football Engine
 * Boundary). No xG computation is implemented yet.
 */
export interface ExpectedGoals {
  readonly eventId: string;
  readonly homeXg: number | null;
  readonly awayXg: number | null;
  readonly asOf: string;
}

export interface XgModel {
  getExpectedGoals(eventId: string, asOf: string): Promise<ExpectedGoals | undefined>;
}
