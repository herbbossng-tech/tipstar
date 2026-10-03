import { describe, expect, it } from "vitest";
import { hasEntitlement } from "./entitlements.js";
import type { UserProfile } from "./types.js";

function profile(entitlements: readonly string[]): UserProfile {
  return {
    identity: { telegramUserId: 1, firstName: "Ada", lastName: undefined, username: undefined, languageCode: undefined, isPremium: undefined, authMode: "telegram", role: "user", status: "active" },
    license: null,
    entitlements,
  };
}

describe("hasEntitlement", () => {
  it("reads only the real server-reported entitlement list (Section 09 §30/§48 — no separate frontend permission store to tamper with)", () => {
    expect(hasEntitlement(profile(["football_analysis"]), "football_analysis")).toBe(true);
    expect(hasEntitlement(profile(["football_analysis"]), "football_tickets")).toBe(false);
  });

  it("returns false, never throws, for an undefined profile (still loading/errored)", () => {
    expect(hasEntitlement(undefined, "football_analysis")).toBe(false);
  });

  it("returns false for an empty entitlement list — never defaults to permissive", () => {
    expect(hasEntitlement(profile([]), "football_analysis")).toBe(false);
  });
});
