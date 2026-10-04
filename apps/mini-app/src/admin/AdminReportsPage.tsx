import { useState, type FormEvent } from "react";
import { useAuthIdentity } from "../auth/AuthContext.js";
import { generateAdminReport, listAdminReports, publishAdminReport } from "../api/adminApi.js";
import type { LedgerMode } from "../api/types.js";
import { ApiError } from "../services/api.js";
import { useQuery } from "../hooks/useQuery.js";
import { EmptyState } from "../shared/EmptyState.js";
import { formatDate, formatDateTime } from "../shared/format.js";
import { LoadingState } from "../shared/LoadingState.js";
import { QueryErrorState } from "../shared/QueryErrorState.js";
import { AdminGuard } from "./AdminGuard.js";

/**
 * Reports (Section 11 §S "Reports"). Generation is NEVER synchronous —
 * submitting the form enqueues a `WEEKLY_REPORT_GENERATION` operational
 * job (via `admin-reports`'s POST handler) and the actual report
 * appears in this list once the job worker has run it. A report row is
 * immutable once created (§M) — regenerating the same period produces
 * a NEW version row with `supersedes_report_id` set, never an in-place
 * edit of the one shown here.
 */
function AdminReportsContent(): JSX.Element {
  const { session } = useAuthIdentity();
  const [ledgerModeFilter, setLedgerModeFilter] = useState<LedgerMode | undefined>(undefined);
  const query = useQuery(() => listAdminReports(session.token, { ledgerMode: ledgerModeFilter }), [session.token, ledgerModeFilter]);

  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [generateLedgerMode, setGenerateLedgerMode] = useState<LedgerMode>("LIVE");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | undefined>(undefined);
  const [generateResultMessage, setGenerateResultMessage] = useState<string | undefined>(undefined);
  const [publishingReportId, setPublishingReportId] = useState<string | undefined>(undefined);
  const [publishError, setPublishError] = useState<string | undefined>(undefined);
  const [publishResultMessage, setPublishResultMessage] = useState<string | undefined>(undefined);

  const handlePublish = (reportId: string): void => {
    setPublishError(undefined);
    setPublishResultMessage(undefined);
    setPublishingReportId(reportId);
    publishAdminReport(session.token, reportId)
      .then((result) => {
        setPublishingReportId(undefined);
        setPublishResultMessage(result.alreadyExisted ? `A publication job for this report already exists (job ${result.jobId}, status ${result.status}).` : `Telegram publication enqueued (job ${result.jobId}, status ${result.status}). Check Jobs for progress.`);
      })
      .catch((error: unknown) => {
        setPublishingReportId(undefined);
        setPublishError(error instanceof ApiError ? error.message : "Could not enqueue report publication.");
      });
  };

  const handleGenerate = (event: FormEvent): void => {
    event.preventDefault();
    if (!periodStart || !periodEnd) return;

    setGenerateError(undefined);
    setGenerateResultMessage(undefined);
    setGenerating(true);
    generateAdminReport(session.token, { periodStart: new Date(periodStart).toISOString(), periodEnd: new Date(periodEnd).toISOString(), ledgerMode: generateLedgerMode })
      .then((result) => {
        setGenerating(false);
        setGenerateResultMessage(result.alreadyExisted ? `A report generation job for this period already exists (job ${result.jobId}, status ${result.status}).` : `Report generation enqueued (job ${result.jobId}, status ${result.status}). Check Jobs for progress.`);
        query.refetch();
      })
      .catch((error: unknown) => {
        setGenerating(false);
        setGenerateError(error instanceof ApiError ? error.message : "Could not enqueue report generation.");
      });
  };

  return (
    <section className="page">
      <h1>Reports</h1>
      <p className="page__subtitle">Weekly operational reports (Section 11) — built from the real performance ledger. PAPER and LIVE are always shown separately.</p>

      <div className="card">
        <div className="card__header">
          <span className="card__title">Generate a report</span>
        </div>
        <form onSubmit={handleGenerate}>
          <div className="field">
            <label className="field__label" htmlFor="admin-report-period-start">
              Period start
            </label>
            <input id="admin-report-period-start" className="field__input" type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} required />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="admin-report-period-end">
              Period end
            </label>
            <input id="admin-report-period-end" className="field__input" type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} required />
          </div>
          <div className="filter-row" role="tablist" aria-label="Ledger mode">
            <button type="button" role="tab" aria-selected={generateLedgerMode === "LIVE"} className={`chip${generateLedgerMode === "LIVE" ? " chip--active" : ""}`} onClick={() => setGenerateLedgerMode("LIVE")}>
              Live
            </button>
            <button type="button" role="tab" aria-selected={generateLedgerMode === "PAPER"} className={`chip${generateLedgerMode === "PAPER" ? " chip--active" : ""}`} onClick={() => setGenerateLedgerMode("PAPER")}>
              Paper
            </button>
          </div>
          <button type="submit" className="button" disabled={generating || !periodStart || !periodEnd}>
            {generating ? "Enqueuing…" : "Generate report"}
          </button>
        </form>
        {generateError ? <QueryErrorState code="GENERATE_FAILED" message={generateError} /> : null}
        {generateResultMessage ? <p className="card__meta">{generateResultMessage}</p> : null}
      </div>

      <div className="filter-row" role="tablist" aria-label="Filter by ledger mode">
        <button type="button" role="tab" aria-selected={ledgerModeFilter === undefined} className={`chip${ledgerModeFilter === undefined ? " chip--active" : ""}`} onClick={() => setLedgerModeFilter(undefined)}>
          All
        </button>
        <button type="button" role="tab" aria-selected={ledgerModeFilter === "LIVE"} className={`chip${ledgerModeFilter === "LIVE" ? " chip--active" : ""}`} onClick={() => setLedgerModeFilter("LIVE")}>
          Live
        </button>
        <button type="button" role="tab" aria-selected={ledgerModeFilter === "PAPER"} className={`chip${ledgerModeFilter === "PAPER" ? " chip--active" : ""}`} onClick={() => setLedgerModeFilter("PAPER")}>
          Paper
        </button>
      </div>

      {query.status === "loading" ? <LoadingState label="Loading reports…" /> : null}
      {query.status === "error" ? <QueryErrorState code={query.code} message={query.message} onRetry={query.refetch} /> : null}
      {query.status === "success" && query.data.reports.length === 0 ? <EmptyState title="No reports" message="No weekly reports have been generated yet for this filter." /> : null}

      {publishError ? <QueryErrorState code="PUBLISH_FAILED" message={publishError} /> : null}
      {publishResultMessage ? <p className="card__meta">{publishResultMessage}</p> : null}

      {query.status === "success" && query.data.reports.length > 0 ? (
        <div className="card-list">
          {query.data.reports.map((report) => (
            <div className="card" key={report.report_id}>
              <div className="card__header">
                <span className="card__title">
                  {formatDate(report.period_start)} – {formatDate(report.period_end)}
                </span>
                <span className="tag">{report.ledger_mode} · v{report.report_version}</span>
              </div>
              <p className="card__detail">Status: {report.status}</p>
              <p className="card__detail">Generated by {report.generated_by} at {formatDateTime(report.generated_at)}</p>
              {report.supersedes_report_id ? <p className="card__detail">Supersedes a prior version{report.superseded_reason ? `: ${report.superseded_reason}` : ""}.</p> : null}
              {report.status === "FINALIZED" ? (
                <button type="button" className="button button--secondary" disabled={publishingReportId === report.report_id} onClick={() => handlePublish(report.report_id)}>
                  {publishingReportId === report.report_id ? "Enqueuing…" : "Publish to Telegram"}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function AdminReportsPage(): JSX.Element {
  return (
    <AdminGuard>
      <AdminReportsContent />
    </AdminGuard>
  );
}
