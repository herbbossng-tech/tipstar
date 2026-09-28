import { NotImplementedNotice } from "../shared/NotImplementedNotice.js";

/** Structural placeholder only (Section 01). No prediction cards or betting UI yet. */
export function FootballPage(): JSX.Element {
  return (
    <section className="page">
      <h1>Football</h1>
      <NotImplementedNotice moduleName="Football intelligence" />
    </section>
  );
}
