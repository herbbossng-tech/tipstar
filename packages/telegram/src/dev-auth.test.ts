import { describe, expect, it } from "vitest";
import { buildDevAuthenticatedIdentity, isDevAuthModeUsable } from "./dev-auth.js";

describe("isDevAuthModeUsable", () => {
  it("is false in production regardless of the flag", () => {
    expect(isDevAuthModeUsable("production", "enabled")).toBe(false);
    expect(isDevAuthModeUsable("production", "disabled")).toBe(false);
  });

  it("is true in non-production only when explicitly enabled", () => {
    expect(isDevAuthModeUsable("development", "enabled")).toBe(true);
    expect(isDevAuthModeUsable("staging", "enabled")).toBe(true);
  });

  it("is false in non-production when the flag is disabled (the default)", () => {
    expect(isDevAuthModeUsable("development", "disabled")).toBe(false);
    expect(isDevAuthModeUsable("staging", "disabled")).toBe(false);
  });
});

describe("buildDevAuthenticatedIdentity", () => {
  it("always returns the same fixed synthetic identity, never parameterized", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const identity = buildDevAuthenticatedIdentity(now);

    expect(identity.telegramUserId).toBe(999_999_999);
    expect(identity.username).toBe("dev_user_do_not_use_in_production");
    expect(identity.authMode).toBe("dev");
  });

  it("takes no client-supplied input that could change the identity", () => {
    const a = buildDevAuthenticatedIdentity(new Date("2026-01-01T00:00:00Z"));
    const b = buildDevAuthenticatedIdentity(new Date("2026-06-15T12:00:00Z"));

    expect(a.telegramUserId).toBe(b.telegramUserId);
    expect(a.username).toBe(b.username);
    expect(a.firstName).toBe(b.firstName);
  });
});
