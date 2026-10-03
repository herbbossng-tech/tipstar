import { useState } from "react";
import { useAuthIdentity } from "../auth/AuthContext.js";
import { getPerformanceSummary } from "../api/performanceApi.js";
import type { LedgerMode } from "../api/types.js";
import { useQuery } from "../hooks/useQuery.js";
import { EmptyState } from "../shared/EmptyState.js";
import { LoadingState } from "../shared/LoadingState.js";
import { QueryErrorState } from "../shared/QueryErrorState.js";
import { PerformanceEntryCard } from "./PerformanceEntryCard.js";

/**
 * Performance Center (Section 09 §24/§27/§54). LIVE and PAPER are always
 * separate views — never combined by default (§22/§27). Filters map
 * directly onto `performance_ledger`'s own real dimensions; no odds/EV
 * bucket filter is offered (that dimension does not exist on this
 * table — see OPEN_QUESTIONS.md).
 */
export function PerformancePage(): JSX.Element {
  const { session } = useAuthIdentity();
  const [ledgerMode, setLedgerMode] = useState<LedgerMode>("LIVE");
  const query = useQuery(() => getPerformanceSummary(session.token, { ledgerMode }), [session.token, ledgerMode]);

  return (
    <section className="page">
      <h1>Performance</h1>
      <div className="filter-row" role="tablist" aria-label="Filter by ledger mode">
        <button type="button" role="tab" aria-selected={ledgerMode === "LIVE"} className={`chip${ledgerMode === "LIVE" ? " chip--active" : ""}`} onClick={() => setLedgerMode("LIVE")}>
          Live
        </button>
        <button type="button" role="tab" aria-selected={ledgerMode === "PAPER"} className={`chip${ledgerMode === "PAPER" ? " chip--active" : ""}`} onClick={() => setLedgerMode("PAPER")}>
          Paper
        </button>
      </div>

      {query.status === "loading" ? <LoadingState label="Loading performance…" /> : null}
      {query.status === "error" ? <QueryErrorState code={query.code} message={query.message} onRetry={query.refetch} /> : null}
      {query.status === "success" && query.data.entries.length === 0 ? <EmptyState title="No performance data" message={ledgerMode === "LIVE" ? "Real live performance figures will appear here once tickets settle." : "Real paper/backtest performance figures will appear here once a backtest run completes."} /> : null}
      {query.status === "success" && query.data.entries.length > 0 ? (
        <div className="card-list">
          {query.data.entries.map((entry) => (
            <PerformanceEntryCard key={entry.id} entry={entry} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
