/**
 * View-model types for the Section 11 `admin-*` edge functions
 * (`admin-overview`, `admin-jobs`, `admin-reports`). OWNER/ADMIN only —
 * every type here mirrors a real response shape those edge functions
 * actually return; nothing here is aspirational. Kept local for the
 * same reason as `api/types.ts`: these are the Mini App's own
 * presentation contracts, not a re-export of server-side packages.
 */

import type { LedgerMode } from "./types.js";

export type JobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";

export type JobType = "WEEKLY_REPORT_GENERATION" | "TELEGRAM_REPORT_PUBLICATION" | "PERFORMANCE_SNAPSHOT" | "OPERATIONAL_HEALTH_CHECK";

export interface AdminReportSummary {
  readonly reportId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly ledgerMode: LedgerMode;
  readonly reportVersion: number;
  readonly generatedAt: string;
}

export interface AdminOverviewResponse {
  readonly activeLicenseCount: number;
  readonly expiringLicenseCount: number;
  readonly queuedJobCount: number;
  readonly runningJobCount: number;
  readonly recentFailedJobCount: number;
  readonly recentAgentFailureCount: number;
  readonly recentReports: readonly AdminReportSummary[];
  readonly generatedAt: string;
}

export interface AdminJobRow {
  readonly job_id: string;
  readonly job_type: JobType;
  readonly status: JobStatus;
  readonly scheduled_at: string;
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly attempts: number;
  readonly max_attempts: number;
  readonly next_attempt_at: string | null;
  readonly last_error: string | null;
  readonly last_failure_category: string | null;
  readonly created_by: string;
  readonly created_at: string;
}

export interface AdminJobsResponse {
  readonly jobs: readonly AdminJobRow[];
}

export interface AdminJobRetryResponse {
  readonly jobId: string;
  readonly status: JobStatus;
}

export interface AdminReportRow {
  readonly report_id: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly ledger_mode: LedgerMode;
  readonly report_version: number;
  readonly status: string;
  readonly generated_at: string;
  readonly generated_by: string;
  readonly supersedes_report_id: string | null;
  readonly superseded_reason: string | null;
}

export interface AdminReportsResponse {
  readonly reports: readonly AdminReportRow[];
}

export interface AdminReportGenerateResponse {
  readonly jobId: string;
  readonly status: JobStatus;
  readonly alreadyExisted: boolean;
}

export interface AdminUserRow {
  readonly id: string;
  readonly telegram_user_id: number;
  readonly username: string | null;
  readonly first_name: string;
  readonly role: "owner" | "admin" | "user";
  readonly status: "active" | "suspended" | "disabled";
  readonly created_at: string;
}

export interface AdminCurrentLicense {
  readonly id: string;
  readonly user_id: string;
  readonly plan: string;
  readonly status: "trial" | "active";
  readonly expires_at: string | null;
}

export interface AdminUserWithLicense {
  readonly user: AdminUserRow;
  readonly currentLicense: AdminCurrentLicense | null;
}

export interface AdminUsersResponse {
  readonly users: readonly AdminUserWithLicense[];
}

export interface AdminLicenseCreateResponse {
  readonly license: {
    readonly id: string;
    readonly user_id: string;
    readonly plan: string;
    readonly status: "trial" | "active";
    readonly starts_at: string;
    readonly expires_at: string | null;
  };
}
