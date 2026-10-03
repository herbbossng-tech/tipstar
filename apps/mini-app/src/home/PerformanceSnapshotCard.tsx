import { Link } from "react-router-dom";
import { getPerformanceSummary } from "../api/performanceApi.js";
import { useQuery } from "../hooks/useQuery.js";
import { formatMoney, formatPercent } from "../shared/format.js";
import { EmptyState } from "../shared/EmptyState.js";
import { LoadingState } from "../shared/LoadingState.js";
import { PerformanceMetric } from "../shared/PerformanceMetric.js";
import { QueryErrorState } from "../shared/QueryErrorState.js";

/** A compact LIVE performance snapshot (Section 09 §9/§24/§37). Sums nothing itself — `entries` are already-aggregated `performance_ledger` rows; this card shows only the most recent entry's own figures, with its real `sampleSize` visible so a tiny sample is never presented as strong. */
export function PerformanceSnapshotCard({ sessionToken }: { readonly sessionToken: string }): JSX.Element {
  const query = useQuery(() => getPerformanceSummary(sessionToken, { ledgerMode: "LIVE" }), [sessionToken]);

  return (
    <section className="card">
      <div className="card__header">
        <h2 className="card__title">Performance (Live)</h2>
        <Link to="/performance" className="card__link">
          View all
        </Link>
      </div>
      {query.status === "loading" ? <LoadingState label="Loading performance…" /> : null}
      {query.status === "error" ? <QueryErrorState code={query.code} message={query.message} /> : null}
      {query.status === "success" && query.data.entries.length === 0 ? <EmptyState title="No performance data" message="Real live performance figures will appear here once tickets settle." /> : null}
      {query.status === "success" && query.data.entries.length > 0
        ? (() => {
            const entry = query.data.entries[0]!;
            return (
              <div className="metric-row">
                <PerformanceMetric label="Net P&L" value={formatMoney(entry.actualPnl, "Not available")} tone={entry.actualPnl && entry.actualPnl.amount > 0 ? "success" : entry.actualPnl && entry.actualPnl.amount < 0 ? "danger" : undefined} />
                <PerformanceMetric label="ROI" value={formatPercent(entry.roi)} />
                <PerformanceMetric label="Sample size" value={String(entry.sampleSize)} />
              </div>
            );
          })()
        : null}
    </section>
  );
}
