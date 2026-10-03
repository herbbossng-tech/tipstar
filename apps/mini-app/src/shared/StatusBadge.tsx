import { glyphForTone, type StatusPresentation } from "./statusPresentation.js";

/**
 * The one status-rendering primitive every screen uses (Section 09 §41 —
 * "status should use icon + text, not color alone"). Renders a small
 * glyph AND the label text together — removing color entirely (e.g. a
 * grayscale/high-contrast override) never loses the meaning.
 */
export function StatusBadge({ label, tone }: StatusPresentation): JSX.Element {
  return (
    <span className={`status-badge status-badge--${tone}`}>
      <span className="status-badge__glyph" aria-hidden="true">
        {glyphForTone(tone)}
      </span>
      <span className="status-badge__label">{label}</span>
    </span>
  );
}
