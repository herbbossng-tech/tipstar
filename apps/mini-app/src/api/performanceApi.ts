import { authedGet } from "../services/api.js";
import type { PerformanceFilters, PerformanceSummaryResponse } from "./types.js";

/** Fetches already-aggregated `performance_ledger` rows from `/performance-summary` (Section 09 §24/§27/§54). Never aggregates raw settlements client-side; `ledgerMode` defaults server-side to LIVE, so PAPER performance is only ever seen when explicitly requested. */
export async function getPerformanceSummary(sessionToken: string, filters: PerformanceFilters = {}): Promise<PerformanceSummaryResponse> {
  return authedGet<PerformanceSummaryResponse>("/performance-summary", sessionToken, { ...filters });
}
