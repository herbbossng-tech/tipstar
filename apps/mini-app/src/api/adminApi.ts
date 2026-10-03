import { authedGet, authedPost } from "../services/api.js";
import type { AdminJobRetryResponse, AdminJobsResponse, AdminOverviewResponse, AdminReportGenerateResponse, AdminReportsResponse, JobStatus, JobType } from "./adminTypes.js";
import type { LedgerMode } from "./types.js";

/** Section 11 admin endpoints. OWNER/ADMIN only — the server independently re-verifies role on every call regardless of what the Mini App renders (§R/§S: "frontend gating is cosmetic"). */

export async function getAdminOverview(sessionToken: string): Promise<AdminOverviewResponse> {
  return authedGet<AdminOverviewResponse>("/admin-overview", sessionToken);
}

export async function listAdminJobs(sessionToken: string, filters: { readonly status?: JobStatus | undefined; readonly jobType?: JobType | undefined } = {}): Promise<AdminJobsResponse> {
  return authedGet<AdminJobsResponse>("/admin-jobs", sessionToken, { status: filters.status, jobType: filters.jobType });
}

export async function retryAdminJob(sessionToken: string, jobId: string): Promise<AdminJobRetryResponse> {
  return authedPost<AdminJobRetryResponse>("/admin-jobs", sessionToken, { action: "retry", jobId });
}

export async function listAdminReports(sessionToken: string, filters: { readonly ledgerMode?: LedgerMode | undefined } = {}): Promise<AdminReportsResponse> {
  return authedGet<AdminReportsResponse>("/admin-reports", sessionToken, { ledgerMode: filters.ledgerMode });
}

export async function generateAdminReport(sessionToken: string, input: { readonly periodStart: string; readonly periodEnd: string; readonly ledgerMode: LedgerMode }): Promise<AdminReportGenerateResponse> {
  return authedPost<AdminReportGenerateResponse>("/admin-reports", sessionToken, { action: "generate", ...input });
}
