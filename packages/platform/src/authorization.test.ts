import { describe, expect, it } from "vitest";
import { AuthorizationError } from "@sport-os/shared";
import { requireActiveUser, requireAdmin, requireNotSelf, requireOwner, requireSelfOrAdmin } from "./authorization.js";
import { Role } from "./license.js";
import { UserStatus, type AuthorizationContext } from "./roles.js";

function context(overrides: Partial<AuthorizationContext> = {}): AuthorizationContext {
  return { userId: "user-1", role: Role.USER, status: UserStatus.ACTIVE, ...overrides };
}

describe("requireAdmin", () => {
  it("allows ADMIN and OWNER, denies USER", () => {
    expect(requireAdmin(context({ role: Role.ADMIN }))).toBeUndefined();
    expect(requireAdmin(context({ role: Role.OWNER }))).toBeUndefined();
    expect(requireAdmin(context({ role: Role.USER }))).toBeInstanceOf(AuthorizationError);
  });
});

describe("requireOwner", () => {
  it("allows only OWNER", () => {
    expect(requireOwner(context({ role: Role.OWNER }))).toBeUndefined();
    expect(requireOwner(context({ role: Role.ADMIN }))).toBeInstanceOf(AuthorizationError);
    expect(requireOwner(context({ role: Role.USER }))).toBeInstanceOf(AuthorizationError);
  });
});

describe("requireSelfOrAdmin", () => {
  it("allows the same user id, or any admin/owner acting on someone else's resource", () => {
    expect(requireSelfOrAdmin(context({ userId: "user-1" }), "user-1")).toBeUndefined();
    expect(requireSelfOrAdmin(context({ userId: "user-1", role: Role.ADMIN }), "user-2")).toBeUndefined();
    expect(requireSelfOrAdmin(context({ userId: "user-1", role: Role.USER }), "user-2")).toBeInstanceOf(AuthorizationError);
  });
});

describe("requireNotSelf", () => {
  it("denies when the target is the acting user, regardless of role", () => {
    expect(requireNotSelf(context({ userId: "user-1", role: Role.OWNER }), "user-1", "no self-service")).toBeInstanceOf(AuthorizationError);
    expect(requireNotSelf(context({ userId: "user-1", role: Role.OWNER }), "user-2", "no self-service")).toBeUndefined();
  });
});

describe("requireActiveUser", () => {
  it("denies a suspended or disabled user", () => {
    expect(requireActiveUser(context({ status: UserStatus.ACTIVE }))).toBeUndefined();
    expect(requireActiveUser(context({ status: UserStatus.SUSPENDED }))).toBeInstanceOf(AuthorizationError);
    expect(requireActiveUser(context({ status: UserStatus.DISABLED }))).toBeInstanceOf(AuthorizationError);
  });
});
