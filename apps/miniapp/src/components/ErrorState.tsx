export interface ErrorStateProps {
  readonly title?: string;
  readonly message: string;
  readonly onRetry?: () => void;
  readonly retryLabel?: string;
}

export function ErrorState({ title = "Something went wrong", message, onRetry, retryLabel = "Try again" }: ErrorStateProps): JSX.Element {
  return (
    <div className="state state--error" role="alert">
      <p className="state__title">{title}</p>
      <p className="state__message">{message}</p>
      {onRetry ? (
        <button type="button" className="button button--secondary" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
