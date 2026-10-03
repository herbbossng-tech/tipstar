/** The one honest "nothing here" presentation (Section 09 §34 — Empty States). Never fake sample data; always a specific, factual message. */
export function EmptyState({ title, message }: { readonly title: string; readonly message: string }): JSX.Element {
  return (
    <div className="state state--empty">
      <p className="state__title">{title}</p>
      <p className="state__message">{message}</p>
    </div>
  );
}
