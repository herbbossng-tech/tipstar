import type { ReactNode } from "react";
import { EmptyState } from "../components/EmptyState.js";
import { ErrorState } from "../components/ErrorState.js";
import { LoadingState } from "../components/LoadingState.js";
import { useAuth } from "./AuthProvider.js";

/**
 * Gates authenticated screens on real session state (Section 24). This is
 * a UX convenience only — every request these screens make still goes
 * through the backend, which independently re-validates the session/JWT
 * and RLS on every call. Client-side gating never substitutes for that.
 */
export function ProtectedRoute({ children }: { readonly children: ReactNode }): JSX.Element {
  const { status, error, isDevBypassAvailable, loginWithDevBypass, refresh } = useAuth();

  switch (status) {
    case "initializing":
    case "authenticating":
      return <LoadingState label="Signing you in…" />;

    case "authenticated":
      return <>{children}</>;

    case "unavailable":
      return (
        <EmptyState
          title="Open Tipstar in Telegram"
          message="Tipstar is a Telegram Mini App — launch it from your Tipstar bot or channel to continue."
          action={
            isDevBypassAvailable ? (
              <button type="button" className="button" onClick={() => void loginWithDevBypass()}>
                Continue as dev user (development only)
              </button>
            ) : undefined
          }
        />
      );

    case "unauthenticated":
      return (
        <EmptyState
          title="Session ended"
          message={error ?? "Please reopen Tipstar from Telegram to sign in again."}
          action={
            isDevBypassAvailable ? (
              <button type="button" className="button" onClick={() => void loginWithDevBypass()}>
                Continue as dev user (development only)
              </button>
            ) : undefined
          }
        />
      );

    case "error":
      return <ErrorState message={error ?? "Something went wrong."} onRetry={() => void refresh()} />;

    default:
      return <LoadingState />;
  }
}
