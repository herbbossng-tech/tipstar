import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { authenticateWithDevBypass, authenticateWithTelegram, fetchCurrentUser } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import type { IssuedSession, UserProfileDTO } from "../api/types.js";
import { clientConfig } from "../config.js";
import { useTelegram } from "../telegram/TelegramProvider.js";

export type AuthStatus =
  | "initializing"
  | "authenticating"
  | "authenticated"
  | "unavailable"
  | "unauthenticated"
  | "error";

export interface AuthContextValue {
  readonly status: AuthStatus;
  readonly currentUser: UserProfileDTO | undefined;
  readonly session: IssuedSession | undefined;
  /** Safe, user-facing message — set whenever status is "error" or "unauthenticated". */
  readonly error: string | undefined;
  readonly isDevBypassAvailable: boolean;
  readonly refresh: () => Promise<void>;
  readonly loginWithDevBypass: () => Promise<void>;
  readonly logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const SESSION_STORAGE_KEY = "tipstar.session.v1";

interface StoredSession {
  readonly session: IssuedSession;
  readonly user: UserProfileDTO;
}

function readStoredSession(): StoredSession | undefined {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as StoredSession;
    if (new Date(parsed.session.expiresAt).getTime() <= Date.now()) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * Session tokens are kept in sessionStorage (not localStorage): they don't
 * outlive the Mini App's WebView tab, which bounds exposure without
 * requiring a credential to be re-entered on every re-render (Section 6 —
 * "don't store sensitive credentials in localStorage unnecessarily").
 */
function writeStoredSession(value: StoredSession | undefined): void {
  try {
    if (value) sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Storage unavailable (private mode, quota) — session simply won't
    // survive a reload; authentication itself still works.
  }
}

export function AuthProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const telegram = useTelegram();
  const attemptedAutoLogin = useRef(false);

  const [stored] = useState(readStoredSession);
  const [status, setStatus] = useState<AuthStatus>(stored ? "authenticated" : "initializing");
  const [currentUser, setCurrentUser] = useState<UserProfileDTO | undefined>(stored?.user);
  const [session, setSession] = useState<IssuedSession | undefined>(stored?.session);
  const [error, setError] = useState<string | undefined>(undefined);

  const applySession = useCallback((next: StoredSession) => {
    writeStoredSession(next);
    setSession(next.session);
    setCurrentUser(next.user);
    setStatus("authenticated");
    setError(undefined);
  }, []);

  const loginWithTelegram = useCallback(
    async (rawInitData: string) => {
      setStatus("authenticating");
      setError(undefined);
      try {
        const response = await authenticateWithTelegram(rawInitData);
        applySession({ session: response.session, user: response.user });
      } catch (caught) {
        const message = caught instanceof ApiError ? caught.message : "Something went wrong. Please try again.";
        setStatus("error");
        setError(message);
      }
    },
    [applySession],
  );

  const loginWithDevBypass = useCallback(async () => {
    setStatus("authenticating");
    setError(undefined);
    try {
      const response = await authenticateWithDevBypass({
        id: 1_000_000_001,
        first_name: "Dev",
        last_name: "User",
        username: "tipstar_dev",
        language_code: "en",
      });
      applySession({ session: response.session, user: response.user });
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : "Something went wrong. Please try again.";
      setStatus("error");
      setError(message);
    }
  }, [applySession]);

  const logout = useCallback(() => {
    writeStoredSession(undefined);
    setSession(undefined);
    setCurrentUser(undefined);
    setStatus("unauthenticated");
  }, []);

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const response = await fetchCurrentUser(session.accessToken);
      setCurrentUser(response.user);
      writeStoredSession({ session, user: response.user });
    } catch (caught) {
      if (caught instanceof ApiError && (caught.status === 401 || caught.code === "session_invalid_or_expired")) {
        logout();
        setStatus("unauthenticated");
        setError("Your session has expired. Please reopen Tipstar.");
        return;
      }
      // Transient failure refreshing profile data — keep the existing
      // session/user rather than bouncing an authenticated user out.
    }
  }, [session, logout]);

  useEffect(() => {
    if (attemptedAutoLogin.current) return;
    if (!telegram.isReady) return;
    if (session) return; // restored from sessionStorage already.

    attemptedAutoLogin.current = true;

    if (telegram.isRunningInTelegram && telegram.rawInitData) {
      void loginWithTelegram(telegram.rawInitData);
    } else if (telegram.isRunningInTelegram && !telegram.rawInitData) {
      setStatus("error");
      setError("Tipstar couldn't read your Telegram session. Please close and reopen the app.");
    } else {
      setStatus("unavailable");
    }
  }, [telegram.isReady, telegram.isRunningInTelegram, telegram.rawInitData, session, loginWithTelegram]);

  const retry = useCallback(async () => {
    if (session) {
      await refresh();
    } else if (telegram.rawInitData) {
      await loginWithTelegram(telegram.rawInitData);
    } else {
      setStatus(telegram.isRunningInTelegram ? "error" : "unavailable");
    }
  }, [session, refresh, telegram.rawInitData, telegram.isRunningInTelegram, loginWithTelegram]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      currentUser,
      session,
      error,
      isDevBypassAvailable: clientConfig.devAuthBypassEnabled,
      refresh: retry,
      loginWithDevBypass,
      logout,
    }),
    [status, currentUser, session, error, retry, loginWithDevBypass, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth() must be used within an <AuthProvider>.");
  }
  return context;
}
