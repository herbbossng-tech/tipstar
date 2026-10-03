/** Scoped loading indicator (Section 09 §35 — "do not block the entire app when only one card is loading"). Callers place this inside the one region that's actually loading, never wrapping the whole page unless the whole page's data is genuinely blocking. */
export function LoadingState({ label }: { readonly label: string }): JSX.Element {
  return (
    <div className="state state--loading" role="status" aria-live="polite">
      <span className="state__spinner" aria-hidden="true" />
      <p className="state__message">{label}</p>
    </div>
  );
}
