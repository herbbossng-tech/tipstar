import { EmptyState } from "../components/EmptyState.js";

/** Foundation only (Section 21) — real fixture data lands in Section 04. */
export function MatchesPage(): JSX.Element {
  return (
    <section className="page">
      <h1>Matches</h1>
      <p className="page__subtitle">Fixtures across Football, Basketball, Virtual Football, and Aviator.</p>
      <EmptyState title="No matches yet" message="Fixtures will appear here once the Sports Data Layer is connected." />
    </section>
  );
}
