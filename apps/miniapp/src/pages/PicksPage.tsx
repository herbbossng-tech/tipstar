import { EmptyState } from "../components/EmptyState.js";

/**
 * Foundation only (Section 20) — ready to receive real Pick Engine data in
 * a later section. No fabricated picks (Section 41, permanent).
 */
export function PicksPage(): JSX.Element {
  return (
    <section className="page">
      <h1>Picks</h1>
      <p className="page__subtitle">Published picks will appear here once the Pick Engine is wired to the backend.</p>
      <EmptyState title="No picks yet" message="Qualified picks will appear here as soon as they're published." />
    </section>
  );
}
