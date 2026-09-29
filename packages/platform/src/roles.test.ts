import { describe, expect, it } from "vitest";
import { Role } from "./license.js";
import { isActiveUser, isAdmin, isOwner, UserStatus, type AuthorizationContext } from "./roles.js";

function context(overrides: Partial<AuthorizationContext> = {}): AuthorizationContext {
  return { userId: "user-1", role: Role.USER, status: UserStatus.ACTIVE, ...overrides };
}

describe("isOwner", () => {
  it("is true only for OWNER", () => {
    expect(isOwner(context({ role: Role.OWNER }))).toBe(true);
    expect(isOwner(context({ role: Role.ADMIN }))).toBe(false);
    expect(isOwner(context({ role: Role.USER }))).toBe(false);
  });
});

describe("isAdmin", () => {
  it("is true for both ADMIN and OWNER, false for USER", () => {
    expect(isAdmin(context({ role: Role.OWNER }))).toBe(true);
    expect(isAdmin(context({ role: Role.ADMIN }))).toBe(true);
    expect(isAdmin(context({ role: Role.USER }))).toBe(false);
  });
});

describe("isActiveUser", () => {
  it("is true only when status is ACTIVE", () => {
    expect(isActiveUser(context({ status: UserStatus.ACTIVE }))).toBe(true);
    expect(isActiveUser(context({ status: UserStatus.SUSPENDED }))).toBe(false);
    expect(isActiveUser(context({ status: UserStatus.DISABLED }))).toBe(false);
  });

  it("role and status are independent axes — a SUSPENDED OWNER is still not an active user", () => {
    expect(isActiveUser(context({ role: Role.OWNER, status: UserStatus.SUSPENDED }))).toBe(false);
    expect(isOwner(context({ role: Role.OWNER, status: UserStatus.SUSPENDED }))).toBe(true);
  });
});
