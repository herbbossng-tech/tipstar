import { describe, expect, it } from "vitest";
import { authReducer, INITIAL_AUTH_STATE, type AuthState } from "./authReducer.js";
import type { AuthenticatedIdentity, AuthSessionHandle } from "./types.js";

const IDENTITY: AuthenticatedIdentity = {
  telegramUserId: 42,
  firstName: "Ada",
  lastName: undefined,
  username: "ada",
  languageCode: "en",
  isPremium: false,
  authMode: "telegram",
};

const DEV_IDENTITY: AuthenticatedIdentity = { ...IDENTITY, telegramUserId: 999_999_999, authMode: "dev" };

const SESSION: AuthSessionHandle = { token: "opaque-token", expiresAt: "2026-01-02T00:00:00.000Z" };

describe("authReducer", () => {
  it("starts in the initializing state", () => {
    expect(INITIAL_AUTH_STATE).toEqual({ status: "initializing" });
  });

  it("moves to telegram_unavailable when Telegram is not present", () => {
    const state = authReducer(INITIAL_AUTH_STATE, { type: "TELEGRAM_UNAVAILABLE" });
    expect(state).toEqual({ status: "telegram_unavailable" });
  });

  it("moves to authenticating when the flow starts", () => {
    const state = authReducer(INITIAL_AUTH_STATE, { type: "START_AUTHENTICATING" });
    expect(state).toEqual({ status: "authenticating" });
  });

  it("moves to authenticated with the verified identity and session on success", () => {
    const authenticating: AuthState = { status: "authenticating" };
    const state = authReducer(authenticating, { type: "AUTH_SUCCEEDED", identity: IDENTITY, session: SESSION });
    expect(state).toEqual({ status: "authenticated", identity: IDENTITY, session: SESSION });
  });

  it("moves to dev_authenticated (distinct from authenticated) on dev-mode success", () => {
    const authenticating: AuthState = { status: "authenticating" };
    const state = authReducer(authenticating, { type: "DEV_AUTH_SUCCEEDED", identity: DEV_IDENTITY, session: SESSION });
    expect(state).toEqual({ status: "dev_authenticated", identity: DEV_IDENTITY, session: SESSION });
    expect(state.status).not.toBe("authenticated");
  });

  it("moves to auth_failed with the server's error code and a safe message", () => {
    const authenticating: AuthState = { status: "authenticating" };
    const state = authReducer(authenticating, { type: "AUTH_FAILED", code: "TELEGRAM_INIT_DATA_INVALID", message: "Couldn't verify your session." });
    expect(state).toEqual({ status: "auth_failed", code: "TELEGRAM_INIT_DATA_INVALID", message: "Couldn't verify your session." });
  });

  it("allows retrying from auth_failed back through authenticating to authenticated", () => {
    const failed: AuthState = { status: "auth_failed", code: "TELEGRAM_INIT_DATA_EXPIRED", message: "Expired." };
    const retrying = authReducer(failed, { type: "START_AUTHENTICATING" });
    expect(retrying).toEqual({ status: "authenticating" });
    const succeeded = authReducer(retrying, { type: "AUTH_SUCCEEDED", identity: IDENTITY, session: SESSION });
    expect(succeeded).toEqual({ status: "authenticated", identity: IDENTITY, session: SESSION });
  });

  it("is a pure function: the same state/action pair always yields an equal (deep-equal) result", () => {
    const a = authReducer(INITIAL_AUTH_STATE, { type: "START_AUTHENTICATING" });
    const b = authReducer(INITIAL_AUTH_STATE, { type: "START_AUTHENTICATING" });
    expect(a).toEqual(b);
  });

  it("never mutates the input state object", () => {
    const before: AuthState = { status: "authenticating" };
    const snapshot = { ...before };
    authReducer(before, { type: "AUTH_SUCCEEDED", identity: IDENTITY, session: SESSION });
    expect(before).toEqual(snapshot);
  });
});
