import type { ReactNode } from "react";

export interface EmptyStateProps {
  readonly title: string;
  readonly message?: string;
  readonly action?: ReactNode;
}

export function EmptyState({ title, message, action }: EmptyStateProps): JSX.Element {
  return (
    <div className="state state--empty">
      <p className="state__title">{title}</p>
      {message ? <p className="state__message">{message}</p> : null}
      {action}
    </div>
  );
}
