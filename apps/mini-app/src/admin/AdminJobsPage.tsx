import { useState } from "react";
import { useAuthIdentity } from "../auth/AuthContext.js";
import { listAdminJobs, retryAdminJob } from "../api/adminApi.js";
import type { JobStatus } from "../api/adminTypes.js";
import { ApiError } from "../services/api.js";
import { useQuery } from "../hooks/useQuery.js";
import { EmptyState } from "../shared/EmptyState.js";
import { formatDateTime } from "../shared/format.js";
import { LoadingState } from "../shared/LoadingState.js";
import { QueryErrorState } from "../shared/QueryErrorState.js";
import { StatusBadge } from "../shared/StatusBadge.js";
import { describeJobStatus } from "../shared/statusPresentation.js";
import { AdminGuard } from "./AdminGuard.js";

const STATUS_FILTERS: readonly { readonly label: string; readonly value: JobStatus | undefined }[] = [
  { label: "All", value: undefined },
  { label: "Queued", value: "QUEUED" },
  { label: "Running", value: "RUNNING" },
  { label: "Failed", value: "FAILED" },
  { label: "Succeeded", value: "SUCCEEDED" },
  { label: "Cancelled", value: "CANCELLED" },
];

/**
 * Jobs (Section 11 §S "Jobs"). Retry is offered ONLY for a FAILED job —
 * the backend's own state machine (`isValidJobTransition`) is the real
 * enforcement; this button is just the matching affordance, and the
 * `admin-jobs` edge function independently re-checks the job's current
 * status before re-queuing it regardless of what was shown here.
 */
function AdminJobsContent(): JSX.Element {
  const { session } = useAuthIdentity();
  const [statusFilter, setStatusFilter] = useState<JobStatus | undefined>(undefined);
  const [retryingJobId, setRetryingJobId] = useState<string | undefined>(undefined);
  const [retryError, setRetryError] = useState<string | undefined>(undefined);
  const query = useQuery(() => listAdminJobs(session.token, { status: statusFilter }), [session.token, statusFilter]);

  const handleRetry = (jobId: string): void => {
    setRetryError(undefined);
    setRetryingJobId(jobId);
    retryAdminJob(session.token, jobId)
      .then(() => {
        setRetryingJobId(undefined);
        query.refetch();
      })
      .catch((error: unknown) => {
        setRetryingJobId(undefined);
        setRetryError(error instanceof ApiError ? error.message : "Could not retry this job.");
      });
  };

  return (
    <section className="page">
      <h1>Jobs</h1>
      <p className="page__subtitle">Durable operational jobs (Section 11) — weekly report generation, Telegram report publication, performance snapshots, health checks.</p>

      <div className="filter-row" role="tablist" aria-label="Filter by job status">
        {STATUS_FILTERS.map((filter) => (
          <button key={filter.label} type="button" role="tab" aria-selected={statusFilter === filter.value} className={`chip${statusFilter === filter.value ? " chip--active" : ""}`} onClick={() => setStatusFilter(filter.value)}>
            {filter.label}
          </button>
        ))}
      </div>

      {retryError ? <QueryErrorState code="RETRY_FAILED" message={retryError} /> : null}

      {query.status === "loading" ? <LoadingState label="Loading jobs…" /> : null}
      {query.status === "error" ? <QueryErrorState code={query.code} message={query.message} onRetry={query.refetch} /> : null}
      {query.status === "success" && query.data.jobs.length === 0 ? <EmptyState title="No jobs" message="No operational jobs match this filter." /> : null}

      {query.status === "success" && query.data.jobs.length > 0 ? (
        <div className="card-list">
          {query.data.jobs.map((job) => {
            const presentation = describeJobStatus(job.status);
            return (
              <div className="card" key={job.job_id}>
                <div className="card__header">
                  <span className="card__title">{job.job_type}</span>
                  <StatusBadge label={presentation.label} tone={presentation.tone} />
                </div>
                <p className="card__detail">Attempts: {job.attempts} / {job.max_attempts}</p>
                <p className="card__detail">Scheduled: {formatDateTime(job.scheduled_at)}</p>
                {job.started_at ? <p className="card__detail">Started: {formatDateTime(job.started_at)}</p> : null}
                {job.completed_at ? <p className="card__detail">Completed: {formatDateTime(job.completed_at)}</p> : null}
                {job.next_attempt_at ? <p className="card__detail">Next attempt: {formatDateTime(job.next_attempt_at)}</p> : null}
                {job.last_error ? <p className="card__detail">Last error: {job.last_error}{job.last_failure_category ? ` (${job.last_failure_category})` : ""}</p> : null}
                <p className="card__meta">Created by {job.created_by} · {formatDateTime(job.created_at)}</p>
                {job.status === "FAILED" ? (
                  <button type="button" className="button button--secondary" disabled={retryingJobId === job.job_id} onClick={() => handleRetry(job.job_id)}>
                    {retryingJobId === job.job_id ? "Retrying…" : "Retry"}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

export function AdminJobsPage(): JSX.Element {
  return (
    <AdminGuard>
      <AdminJobsContent />
    </AdminGuard>
  );
}
