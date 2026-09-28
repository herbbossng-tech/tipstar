import { useEffect, useReducer, type ReactNode } from "react";
import { authenticateWithDevMode, authenticateWithTelegram } from "../auth/authApi.js";
import { AuthIdentityProvider } from "../auth/AuthContext.js";
import { authReducer, INITIAL_AUTH_STATE } from "../auth/authReducer.js";
import { clientConfig } from "../config.js";
import { ApiError } from "../services/api.js";
import { TelegramProvider, useTelegram } from "../telegram/TelegramProvider.js";

function describeAuthFailure(error: unknown): { code: string; message: string } {
  if (error instanceof ApiError) {
    return { code: error.code, message: error.message };
  }
  return { code: "unknown_error", message: "Something went wrong while signing you in. Please try again." };
}

function AuthBoundaryInner({ children }: { readonly children: ReactNode }): JSX.Element {
  const telegram = useTelegram();
  const [state, dispatch] = useReducer(authReducer, INITIAL_AUTH_STATE);

  const runTelegramAuth = (): void => {
    if (!telegram.isAvailable) {
      dispatch({ type: "TELEGRAM_UNAVAILABLE" });
      return;
    }

    dispatch({ type: "START_AUTHENTICATING" });
    authenticateWithTelegram(telegram.getRawInitData())
      .then((response) => dispatch({ type: "AUTH_SUCCEEDED", identity: response.identity, session: response.session }))
      .catch((error: unknown) => dispatch({ type: "AUTH_FAILED", ...describeAuthFailure(error) }));
  };

  useEffect(() => {
    telegram.ready();
    runTelegramAuth();
  }, [telegram]);

  const startDevAuth = (): void => {
    dispatch({ type: "START_AUTHENTICATING" });
    authenticateWithDevMode()
      .then((response) => dispatch({ type: "DEV_AUTH_SUCCEEDED", identity: response.identity, session: response.session }))
      .catch((error: unknown) => dispatch({ type: "AUTH_FAILED", ...describeAuthFailure(error) }));
  };

  if (state.status === "initializing" || state.status === "authenticating") {
    return (
      <div className="state state--loading" role="status" aria-live="polite">
        <span className="state__spinner" aria-hidden="true" />
        <p className="state__message">Signing you in…</p>
      </div>
    );
  }

  if (state.status === "telegram_unavailable") {
    return (
      <div className="state state--error" role="alert">
        <p className="state__title">Open this app from Telegram</p>
        <p className="state__message">This Mini App only works inside Telegram.</p>
        {clientConfig.devAuthModeEnabled ? (
          <button type="button" className="button button--secondary" onClick={startDevAuth}>
            Continue in dev mode
          </button>
        ) : null}
      </div>
    );
  }

  if (state.status === "auth_failed") {
    return (
      <div className="state state--error" role="alert">
        <p className="state__title">Couldn't verify your session</p>
        <p className="state__message">{state.message}</p>
        <button type="button" className="button button--secondary" onClick={runTelegramAuth}>
          Try again
        </button>
      </div>
    );
  }

  return <AuthIdentityProvider value={{ identity: state.identity, session: state.session }}>{children}</AuthIdentityProvider>;
}

/**
 * Real authentication boundary (Section 02 — Telegram Authentication).
 * Establishes a server-verified identity before any route renders: never
 * trusts `initDataUnsafe`, only the raw `initData` string exchanged with
 * the server (see docs/architecture/TELEGRAM_AUTHENTICATION.md). The
 * dev-mode fallback is only offered when clientConfig.devAuthModeEnabled
 * is true, and the server independently re-verifies it is actually usable
 * regardless of what the client believes.
 */
export function AuthBoundary({ children }: { readonly children: ReactNode }): JSX.Element {
  return (
    <TelegramProvider>
      <AuthBoundaryInner>{children}</AuthBoundaryInner>
    </TelegramProvider>
  );
}
