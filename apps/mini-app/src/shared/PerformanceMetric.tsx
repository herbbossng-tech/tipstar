import type { StatusTone } from "./statusPresentation.js";

/** One labeled metric tile (Section 09 §24 — Performance Center). `tone` is optional — most metrics (odds, counts) carry no inherent good/bad tone; only P&L-shaped metrics should pass one. */
export function PerformanceMetric({ label, value, tone }: { readonly label: string; readonly value: string; readonly tone?: StatusTone | undefined }): JSX.Element {
  return (
    <div className="metric">
      <span className="metric__label">{label}</span>
      <span className={`metric__value${tone ? ` metric__value--${tone}` : ""}`}>{value}</span>
    </div>
  );
}
