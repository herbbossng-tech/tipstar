/**
 * Differentiated error presentation (Section 09 §33 — Error UX). Maps a
 * handful of well-known backend error codes to a useful, factual
 * explanation; anything else falls back to the server's own safe
 * message (never a raw stack trace or internal detail — the server
 * itself already guarantees that, see `ApiError`/`apiRequest`).
 */
export function describeErrorCode(code: string, serverMessage: string): string {
  switch (code) {
    case "network_error":
      return "Could not reach the server. Check your connection and try again.";
    case "timeout":
      return "The request took too long. Please try again.";
    case "SESSION_MISSING":
    case "SESSION_INVALID":
    case "SESSION_EXPIRED":
    case "SESSION_REVOKED":
      return "Your session has ended. Please reopen the app.";
    case "LICENSE_UNAVAILABLE":
      return "You don't have an active license for this feature.";
    case "FEATURE_NOT_ENTITLED":
      return "This feature is not included in your current plan.";
    case "ACCOUNT_SUSPENDED":
      return "Your account is not active.";
    case "NOT_FOUND":
      return "This could not be found.";
    default:
      return serverMessage;
  }
}

export function QueryErrorState({ code, message, onRetry }: { readonly code: string; readonly message: string; readonly onRetry?: () => void }): JSX.Element {
  return (
    <div className="state state--error" role="alert">
      <p className="state__message">{describeErrorCode(code, message)}</p>
      {onRetry ? (
        <button type="button" className="button button--secondary" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
