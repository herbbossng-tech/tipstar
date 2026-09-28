import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type AuthBoundaryStatus = "loading" | "ready" | "error";

interface AuthBoundaryContextValue {
  readonly status: AuthBoundaryStatus;
}

const AuthBoundaryContext = createContext<AuthBoundaryContextValue | undefined>(undefined);

/**
 * Structural authentication/loading boundary (Section 01 — Frontend
 * Foundation). This is intentionally NOT a real authentication flow —
 * Telegram Mini App identity verification is a later-section concern
 * (Security Principle: the frontend is never the security boundary; real
 * verification happens server-side). This component only establishes
 * where that flow will plug in, and gives every route a consistent
 * loading state instead of a blank screen while it does.
 */
export function AuthBoundary({ children }: { readonly children: ReactNode }): JSX.Element {
  const [status, setStatus] = useState<AuthBoundaryStatus>("loading");

  useEffect(() => {
    // No real identity check exists yet — resolve to "ready" immediately.
    // Replace this effect with a real Telegram initData exchange once the
    // backend auth endpoint exists.
    setStatus("ready");
  }, []);

  if (status === "loading") {
    return (
      <div className="state state--loading" role="status" aria-live="polite">
        <span className="state__spinner" aria-hidden="true" />
        <p className="state__message">Loading…</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="state state--error" role="alert">
        <p className="state__title">Couldn't verify your session</p>
        <p className="state__message">Please reopen the app.</p>
      </div>
    );
  }

  return <AuthBoundaryContext.Provider value={{ status }}>{children}</AuthBoundaryContext.Provider>;
}

export function useAuthBoundaryStatus(): AuthBoundaryStatus {
  const context = useContext(AuthBoundaryContext);
  return context?.status ?? "loading";
}
