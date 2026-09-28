import { NotImplementedNotice } from "../shared/NotImplementedNotice.js";

/** Structural placeholder only (Section 01). No signals or betting UI yet. */
export function AviatorPage(): JSX.Element {
  return (
    <section className="page">
      <h1>Aviator</h1>
      <NotImplementedNotice moduleName="Aviator intelligence" />
    </section>
  );
}
