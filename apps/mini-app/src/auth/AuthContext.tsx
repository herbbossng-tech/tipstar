import { createContext, useContext } from "react";
import type { AuthenticatedIdentity, AuthSessionHandle } from "./types.js";

export interface AuthIdentityContextValue {
  readonly identity: AuthenticatedIdentity;
  readonly session: AuthSessionHandle;
}

const AuthIdentityContext = createContext<AuthIdentityContextValue | undefined>(undefined);

export const AuthIdentityProvider = AuthIdentityContext.Provider;

/**
 * Only usable inside AuthBoundary's authenticated subtree (see
 * shared/AuthBoundary.tsx) — every route already renders under it, so any
 * page component can call this instead of re-deriving identity itself.
 * The session token here is held in memory only for the lifetime of this
 * provider; it is never written to localStorage/sessionStorage.
 */
export function useAuthIdentity(): AuthIdentityContextValue {
  const value = useContext(AuthIdentityContext);
  if (!value) {
    throw new Error("useAuthIdentity() must be used within an authenticated AuthBoundary subtree.");
  }
  return value;
}
