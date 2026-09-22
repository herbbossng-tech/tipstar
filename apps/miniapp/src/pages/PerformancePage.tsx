import { EmptyState } from "../components/EmptyState.js";

/**
 * Foundation only (Section 22) — the real Performance Engine (Section 08)
 * derives every number here from settled picks. No fabricated statistics
 * (Section 41, permanent).
 */
export function PerformancePage(): JSX.Element {
  return (
    <section className="page">
      <h1>Performance</h1>
      <p className="page__subtitle">Verified historical performance, derived from settled picks.</p>
      <EmptyState title="No settled picks yet" message="Win rate, ROI, and streaks will appear here once picks have been settled." />
    </section>
  );
}
