import type { AuthenticatedIdentity, AuthSessionHandle } from "./types.js";

/**
 * Six explicit states drive the Mini App's authentication boundary
 * (Section 02). Kept as a discriminated union so every render site is
 * forced to handle each case — no implicit "authenticated" fallback that
 * could render protected content before identity is actually verified.
 */
export type AuthState =
  | { readonly status: "initializing" }
  | { readonly status: "telegram_unavailable" }
  | { readonly status: "authenticating" }
  | { readonly status: "authenticated"; readonly identity: AuthenticatedIdentity; readonly session: AuthSessionHandle }
  | { readonly status: "dev_authenticated"; readonly identity: AuthenticatedIdentity; readonly session: AuthSessionHandle }
  | { readonly status: "auth_failed"; readonly code: string; readonly message: string };

export type AuthAction =
  | { readonly type: "TELEGRAM_UNAVAILABLE" }
  | { readonly type: "START_AUTHENTICATING" }
  | { readonly type: "AUTH_SUCCEEDED"; readonly identity: AuthenticatedIdentity; readonly session: AuthSessionHandle }
  | { readonly type: "DEV_AUTH_SUCCEEDED"; readonly identity: AuthenticatedIdentity; readonly session: AuthSessionHandle }
  | { readonly type: "AUTH_FAILED"; readonly code: string; readonly message: string };

export const INITIAL_AUTH_STATE: AuthState = { status: "initializing" };

/**
 * Pure reducer, deliberately dependency-free (no React import) so it's
 * testable standalone — see authReducer.test.ts — independent of how it's
 * wired up in shared/AuthBoundary.tsx.
 */
export function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case "TELEGRAM_UNAVAILABLE":
      return { status: "telegram_unavailable" };
    case "START_AUTHENTICATING":
      return { status: "authenticating" };
    case "AUTH_SUCCEEDED":
      return { status: "authenticated", identity: action.identity, session: action.session };
    case "DEV_AUTH_SUCCEEDED":
      return { status: "dev_authenticated", identity: action.identity, session: action.session };
    case "AUTH_FAILED":
      return { status: "auth_failed", code: action.code, message: action.message };
    default:
      return state;
  }
}
