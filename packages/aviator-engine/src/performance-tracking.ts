/**
 * Performance Tracking boundary (Section 01 — Aviator Engine Boundary).
 * Tracks real, settled Aviator outcomes over time — never fabricated
 * statistics. Persistence is a Section 03 (database) concern.
 */
export interface AviatorPerformanceSummary {
  readonly totalSignals: number;
  readonly settledSignals: number;
  readonly winRate: number | null;
}

export interface AviatorPerformanceTracker {
  getSummary(): Promise<AviatorPerformanceSummary>;
}
