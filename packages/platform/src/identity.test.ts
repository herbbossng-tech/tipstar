import { describe, expect, it } from "vitest";
import type { AuthenticatedTelegramIdentity } from "@sport-os/telegram";
import { DatabaseIdentityService, InMemoryUsersRepository, upsertAuthenticatedTelegramUser } from "./identity.js";
import { Role } from "./license.js";
import { UserStatus } from "./roles.js";

function buildTelegramIdentity(overrides: Partial<AuthenticatedTelegramIdentity> = {}): AuthenticatedTelegramIdentity {
  return {
    telegramUserId: 42,
    firstName: "Ada",
    lastName: undefined,
    username: "ada",
    languageCode: "en",
    isPremium: false,
    authDate: "2026-01-01T00:00:00.000Z",
    verifiedAt: "2026-01-01T00:00:00.000Z",
    authMode: "telegram",
    ...overrides,
  };
}

describe("upsertAuthenticatedTelegramUser", () => {
  it("creates a new user defaulting to role USER and status ACTIVE", async () => {
    const users = new InMemoryUsersRepository();
    const user = await upsertAuthenticatedTelegramUser(users, buildTelegramIdentity());

    expect(user.telegramUserId).toBe(42);
    expect(user.firstName).toBe("Ada");
    expect(user.role).toBe(Role.USER);
    expect(user.status).toBe(UserStatus.ACTIVE);
  });

  it("updates safe profile fields on a returning user without ever touching role/status", async () => {
    const users = new InMemoryUsersRepository();
    const first = await upsertAuthenticatedTelegramUser(users, buildTelegramIdentity({ firstName: "Ada" }));
    await users.updateRole(first.id, Role.ADMIN);
    await users.updateStatus(first.id, UserStatus.SUSPENDED);

    const second = await upsertAuthenticatedTelegramUser(users, buildTelegramIdentity({ firstName: "Ada Lovelace", username: "ada2" }));

    expect(second.id).toBe(first.id);
    expect(second.firstName).toBe("Ada Lovelace");
    expect(second.username).toBe("ada2");
    // Role/status set out-of-band by an admin operation must survive an
    // ordinary re-authentication — the identity payload has no way to
    // touch them at all.
    expect(second.role).toBe(Role.ADMIN);
    expect(second.status).toBe(UserStatus.SUSPENDED);
  });

  it("the identity payload has no field that could set role or status — this is a compile-time guarantee, not a runtime check", () => {
    // AuthenticatedTelegramIdentity (from @sport-os/telegram) has no
    // role/status field at all; TypeScript itself is the enforcement
    // here. This test exists to document that guarantee explicitly.
    const identity = buildTelegramIdentity();
    expect(Object.keys(identity)).not.toContain("role");
    expect(Object.keys(identity)).not.toContain("status");
  });
});

describe("DatabaseIdentityService", () => {
  it("resolve() returns undefined for an unknown Telegram user", async () => {
    const service = new DatabaseIdentityService(new InMemoryUsersRepository());
    expect(await service.resolve(999)).toBeUndefined();
  });

  it("resolveOrCreate() creates on first call and returns the same internal id on a second call", async () => {
    const service = new DatabaseIdentityService(new InMemoryUsersRepository());
    const first = await service.resolveOrCreate(42, "ada");
    const second = await service.resolveOrCreate(42, "ada");
    expect(second.userId).toBe(first.userId);
  });
});
