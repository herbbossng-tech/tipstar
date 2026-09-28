import { describe, expect, it } from "vitest";
import { AuditOutcome, InMemoryAuditService } from "./audit.js";
import { InMemoryUsersRepository } from "./identity.js";
import { Role } from "./license.js";
import { UserStatus, type AppUser, type AuthorizationContext } from "./roles.js";
import { changeUserRole, reactivateUser, suspendUser } from "./user-admin.js";

async function seedUser(users: InMemoryUsersRepository, telegramUserId: number, role: Role = Role.USER): Promise<AppUser> {
  const user = await users.upsertFromTelegram({
    telegramUserId,
    username: undefined,
    firstName: `User ${telegramUserId}`,
    lastName: undefined,
    languageCode: undefined,
    isPremium: false,
    authenticatedAt: new Date().toISOString(),
  });
  if (role === Role.USER) return user;
  return users.updateRole(user.id, role);
}

function actingAs(user: AppUser): AuthorizationContext {
  return { userId: user.id, role: user.role, status: user.status };
}

describe("suspendUser / reactivateUser", () => {
  it("an ADMIN can suspend an ordinary USER, recording an audit event", async () => {
    const users = new InMemoryUsersRepository();
    const audit = new InMemoryAuditService();
    const admin = await seedUser(users, 1, Role.ADMIN);
    const target = await seedUser(users, 2, Role.USER);

    const result = await suspendUser(users, audit, actingAs(admin), target.id);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe(UserStatus.SUSPENDED);
    expect(audit.getEvents().some((e) => e.action === "user_suspended")).toBe(true);
  });

  it("a USER cannot suspend anyone", async () => {
    const users = new InMemoryUsersRepository();
    const audit = new InMemoryAuditService();
    const actor = await seedUser(users, 1, Role.USER);
    const target = await seedUser(users, 2, Role.USER);

    const result = await suspendUser(users, audit, actingAs(actor), target.id);

    expect(result.ok).toBe(false);
  });

  it("nobody may suspend their own account, even an ADMIN", async () => {
    const users = new InMemoryUsersRepository();
    const audit = new InMemoryAuditService();
    const admin = await seedUser(users, 1, Role.ADMIN);

    const result = await suspendUser(users, audit, actingAs(admin), admin.id);

    expect(result.ok).toBe(false);
  });

  it("reactivateUser reverses a suspension", async () => {
    const users = new InMemoryUsersRepository();
    const audit = new InMemoryAuditService();
    const admin = await seedUser(users, 1, Role.ADMIN);
    const target = await seedUser(users, 2, Role.USER);
    await suspendUser(users, audit, actingAs(admin), target.id);

    const result = await reactivateUser(users, audit, actingAs(admin), target.id);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe(UserStatus.ACTIVE);
  });
});

describe("changeUserRole — role escalation", () => {
  it("USER -> ADMIN fails (not an admin)", async () => {
    const users = new InMemoryUsersRepository();
    const audit = new InMemoryAuditService();
    const actor = await seedUser(users, 1, Role.USER);
    const target = await seedUser(users, 2, Role.USER);

    const result = await changeUserRole(users, audit, actingAs(actor), target.id, Role.ADMIN);
    expect(result.ok).toBe(false);
  });

  it("USER -> OWNER fails", async () => {
    const users = new InMemoryUsersRepository();
    const audit = new InMemoryAuditService();
    const actor = await seedUser(users, 1, Role.USER);
    const target = await seedUser(users, 2, Role.USER);

    const result = await changeUserRole(users, audit, actingAs(actor), target.id, Role.OWNER);
    expect(result.ok).toBe(false);
  });

  it("ADMIN -> OWNER (an admin promoting someone to owner) fails", async () => {
    const users = new InMemoryUsersRepository();
    const audit = new InMemoryAuditService();
    const admin = await seedUser(users, 1, Role.ADMIN);
    const target = await seedUser(users, 2, Role.USER);

    const result = await changeUserRole(users, audit, actingAs(admin), target.id, Role.OWNER);
    expect(result.ok).toBe(false);
  });

  it("ADMIN cannot demote an existing OWNER", async () => {
    const users = new InMemoryUsersRepository();
    const audit = new InMemoryAuditService();
    const admin = await seedUser(users, 1, Role.ADMIN);
    const owner = await seedUser(users, 2, Role.OWNER);

    const result = await changeUserRole(users, audit, actingAs(admin), owner.id, Role.ADMIN);
    expect(result.ok).toBe(false);
  });

  it("OWNER can promote a USER to ADMIN, and it is audited", async () => {
    const users = new InMemoryUsersRepository();
    const audit = new InMemoryAuditService();
    const owner = await seedUser(users, 1, Role.OWNER);
    const target = await seedUser(users, 2, Role.USER);

    const result = await changeUserRole(users, audit, actingAs(owner), target.id, Role.ADMIN);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.role).toBe(Role.ADMIN);
    const event = audit.getEvents().find((e) => e.action === "role_changed");
    expect(event?.outcome).toBe(AuditOutcome.SUCCESS);
    expect(event?.metadata).toEqual({ fromRole: Role.USER, toRole: Role.ADMIN });
  });

  it("nobody may change their own role, not even an OWNER", async () => {
    const users = new InMemoryUsersRepository();
    const audit = new InMemoryAuditService();
    const owner = await seedUser(users, 1, Role.OWNER);

    const result = await changeUserRole(users, audit, actingAs(owner), owner.id, Role.ADMIN);
    expect(result.ok).toBe(false);
  });
});
