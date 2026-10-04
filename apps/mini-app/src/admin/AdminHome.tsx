import { Link } from "react-router-dom";
import { useAuthIdentity } from "../auth/AuthContext.js";
import { getAdminOverview } from "../api/adminApi.js";
import { useQuery } from "../hooks/useQuery.js";
import { EmptyState } from "../shared/EmptyState.js";
import { formatDateTime } from "../shared/format.js";
import { LoadingState } from "../shared/LoadingState.js";
import { PerformanceMetric } from "../shared/PerformanceMetric.js";
import { QueryErrorState } from "../shared/QueryErrorState.js";
import { AdminGuard } from "./AdminGuard.js";

/**
 * Admin Home (Section 11 §S). Real, bounded operational counts only —
 * no estimate/forecast of any kind. Links out to the Jobs/Reports
 * screens for anything this snapshot can't show in full.
 */
function AdminHomeContent(): JSX.Element {
  const { session } = useAuthIdentity();
  const query = useQuery(() => getAdminOverview(session.token), [session.token]);

  return (
    <section className="page">
      <h1>Admin</h1>
      <p className="page__subtitle">Operational control plane — licenses, jobs, and reporting.</p>

      <div className="filter-row">
        <Link to="/admin/licenses" className="button button--secondary">
          Licenses
        </Link>
        <Link to="/admin/jobs" className="button button--secondary">
          Jobs
        </Link>
        <Link to="/admin/reports" className="button button--secondary">
          Reports
        </Link>
      </div>

      {query.status === "loading" ? <LoadingState label="Loading operational overview…" /> : null}
      {query.status === "error" ? <QueryErrorState code={query.code} message={query.message} onRetry={query.refetch} /> : null}

      {query.status === "success" ? (
        <>
          <div className="card">
            <div className="card__header">
              <span className="card__title">Licensing</span>
            </div>
            <div className="metric-row">
              <PerformanceMetric label="Active/trial licenses" value={String(query.data.activeLicenseCount)} />
              <PerformanceMetric label="Expiring within 7 days" value={String(query.data.expiringLicenseCount)} tone={query.data.expiringLicenseCount > 0 ? "warning" : undefined} />
            </div>
          </div>

          <div className="card">
            <div className="card__header">
              <span className="card__title">Jobs</span>
              <Link to="/admin/jobs" className="card__link">
                View all
              </Link>
            </div>
            <div className="metric-row">
              <PerformanceMetric label="Queued" value={String(query.data.queuedJobCount)} />
              <PerformanceMetric label="Running" value={String(query.data.runningJobCount)} />
              <PerformanceMetric label="Recent failures" value={String(query.data.recentFailedJobCount)} tone={query.data.recentFailedJobCount > 0 ? "danger" : "success"} />
            </div>
          </div>

          <div className="card">
            <div className="card__header">
              <span className="card__title">Agents</span>
            </div>
            <div className="metric-row">
              <PerformanceMetric label="Recent agent failures" value={String(query.data.recentAgentFailureCount)} tone={query.data.recentAgentFailureCount > 0 ? "danger" : "success"} />
            </div>
          </div>

          <div className="card">
            <div className="card__header">
              <span className="card__title">Recent reports</span>
              <Link to="/admin/reports" className="card__link">
                View all
              </Link>
            </div>
            {query.data.recentReports.length === 0 ? (
              <EmptyState title="No reports yet" message="No weekly reports have been generated yet." />
            ) : (
              <ul className="entitlement-list">
                {query.data.recentReports.map((report) => (
                  <li key={report.reportId}>
                    {report.ledgerMode} · v{report.reportVersion} · {formatDateTime(report.generatedAt)}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="card__meta">Last updated {formatDateTime(query.data.generatedAt)}</p>
        </>
      ) : null}
    </section>
  );
}

export function AdminHome(): JSX.Element {
  return (
    <AdminGuard>
      <AdminHomeContent />
    </AdminGuard>
  );
}
