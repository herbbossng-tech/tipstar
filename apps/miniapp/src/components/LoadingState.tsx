export function LoadingState({ label = "Loading…" }: { readonly label?: string }): JSX.Element {
  return (
    <div className="state state--loading" role="status" aria-live="polite">
      <span className="state__spinner" aria-hidden="true" />
      <p className="state__message">{label}</p>
    </div>
  );
}
