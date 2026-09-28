import { NotImplementedNotice } from "../shared/NotImplementedNotice.js";

/**
 * Structural placeholder only (Section 01). No fabricated picks, win
 * rates, or performance figures — see docs/architecture/ARCHITECTURE.md's
 * data integrity principles.
 */
export function DashboardPage(): JSX.Element {
  return (
    <section className="page">
      <h1>Dashboard</h1>
      <p className="page__subtitle">Sport Intelligence OS</p>
      <NotImplementedNotice moduleName="The dashboard" />
    </section>
  );
}
