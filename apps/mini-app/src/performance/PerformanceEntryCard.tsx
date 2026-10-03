import type { PerformanceLedgerEntryView } from "../api/types.js";
import { PerformanceMetric } from "../shared/PerformanceMetric.js";
import { formatDate, formatMoney, formatPercent, formatSignedPercent } from "../shared/format.js";

/**
 * One performance breakdown entry (Section 09 §24/§25/§37). Every
 * metric retains its own defined meaning — wins/losses/voids/pushes/
 * pending are shown as real counts (never re-derived), and NULL metrics
 * (e.g. ROI with zero stake) render "Not available", never 0%.
 * `sampleSize` is always visible so a tiny sample is never mistaken for
 * a strong result.
 */
export function PerformanceEntryCard({ entry }: { readonly entry: PerformanceLedgerEntryView }): JSX.Element {
  const pnlTone = entry.actualPnl === null ? undefined : entry.actualPnl.amount > 0 ? "success" : entry.actualPnl.amount < 0 ? "danger" : undefined;

  return (
    <div className="card">
      <div className="card__header">
        <span className="card__title">
          {entry.sport}
          {entry.league ? ` · ${entry.league}` : ""}
          {entry.market ? ` · ${entry.market}` : ""}
        </span>
        <span className="tag">{formatDate(entry.periodStart)} – {formatDate(entry.periodEnd)}</span>
      </div>
      <div className="metric-row">
        <PerformanceMetric label="Net P&L" value={formatMoney(entry.actualPnl, "Not available")} tone={pnlTone} />
        <PerformanceMetric label="ROI" value={formatPercent(entry.roi)} />
        <PerformanceMetric label="Expected EV" value={formatSignedPercent(entry.expectedEv)} />
      </div>
      <div className="metric-row">
        <PerformanceMetric label="Tickets" value={String(entry.ticketCount)} />
        <PerformanceMetric label="Wins" value={String(entry.wins)} tone="success" />
        <PerformanceMetric label="Losses" value={String(entry.losses)} tone="danger" />
        <PerformanceMetric label="Pending" value={String(entry.pending)} />
      </div>
      <div className="metric-row">
        <PerformanceMetric label="Max drawdown" value={entry.maxDrawdown === null ? "Not available" : entry.maxDrawdown.toFixed(2)} />
        <PerformanceMetric label="Longest losing streak" value={entry.longestLosingStreak === null ? "Not available" : String(entry.longestLosingStreak)} />
        <PerformanceMetric label="Sample size" value={String(entry.sampleSize)} />
      </div>
    </div>
  );
}
