import { describe, expect, it } from "vitest";
import { AuditOutcome, InMemoryAuditService } from "./audit.js";
import { InMemoryUsersRepository } from "./identity.js";
import { Role } from "./license.js";
import { bootstrapOwner, InMemoryPlatformSettingsRepository } from "./owner-bootstrap.js";

const SECRET = "test-owner-bootstrap-secret-do-not-use-in-production";

describe("bootstrapOwner", () => {
  it("fails closed (not configured) when no secret is configured at all", async () => {
    const users = new InMemoryUsersRepository();
    const settings = new InMemoryPlatformSettingsRepository();
    const audit = new InMemoryAuditService();
    await users.upsertFromTelegram({ telegramUserId: 1, username: undefined, firstName: "A", lastName: undefined, languageCode: undefined, isPremium: false, authenticatedAt: new Date().toISOString() });

    const result = await bootstrapOwner(users, settings, audit, { telegramUserId: 1, providedSecret: "anything", configuredSecret: undefined });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("OWNER_BOOTSTRAP_NOT_CONFIGURED");
  });

  it("rejects an incorrect secret", async () => {
    const users = new InMemoryUsersRepository();
    const settings = new InMemoryPlatformSettingsRepository();
    const audit = new InMemoryAuditService();
    await users.upsertFromTelegram({ telegramUserId: 1, username: undefined, firstName: "A", lastName: undefined, languageCode: undefined, isPremium: false, authenticatedAt: new Date().toISOString() });

    const result = await bootstrapOwner(users, settings, audit, { telegramUserId: 1, providedSecret: "wrong-secret", configuredSecret: SECRET });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("OWNER_BOOTSTRAP_SECRET_INVALID");
  });

  it("fails when the target Telegram user has never authenticated (no users row)", async () => {
    const users = new InMemoryUsersRepository();
    const settings = new InMemoryPlatformSettingsRepository();
    const audit = new InMemoryAuditService();

    const result = await bootstrapOwner(users, settings, audit, { telegramUserId: 999, providedSecret: SECRET, configuredSecret: SECRET });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("OWNER_BOOTSTRAP_USER_NOT_FOUND");
  });

  it("promotes the user to OWNER, marks the platform bootstrapped, and records an audit event", async () => {
    const users = new InMemoryUsersRepository();
    const settings = new InMemoryPlatformSettingsRepository();
    const audit = new InMemoryAuditService();
    await users.upsertFromTelegram({ telegramUserId: 1, username: undefined, firstName: "A", lastName: undefined, languageCode: undefined, isPremium: false, authenticatedAt: new Date().toISOString() });

    const result = await bootstrapOwner(users, settings, audit, { telegramUserId: 1, providedSecret: SECRET, configuredSecret: SECRET });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.role).toBe(Role.OWNER);
    expect(await settings.isOwnerBootstrapped()).toBe(true);
    const event = audit.getEvents().find((e) => e.action === "owner_bootstrapped");
    expect(event?.outcome).toBe(AuditOutcome.SUCCESS);
  });

  it("refuses to run a second time even with the correct secret", async () => {
    const users = new InMemoryUsersRepository();
    const settings = new InMemoryPlatformSettingsRepository();
    const audit = new InMemoryAuditService();
    const first = await users.upsertFromTelegram({ telegramUserId: 1, username: undefined, firstName: "A", lastName: undefined, languageCode: undefined, isPremium: false, authenticatedAt: new Date().toISOString() });
    const second = await users.upsertFromTelegram({ telegramUserId: 2, username: undefined, firstName: "B", lastName: undefined, languageCode: undefined, isPremium: false, authenticatedAt: new Date().toISOString() });
    void first;

    await bootstrapOwner(users, settings, audit, { telegramUserId: 1, providedSecret: SECRET, configuredSecret: SECRET });
    const result = await bootstrapOwner(users, settings, audit, { telegramUserId: 2, providedSecret: SECRET, configuredSecret: SECRET });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("OWNER_BOOTSTRAP_ALREADY_DONE");
    // The second (rejected) target must never have been promoted.
    const secondUser = await users.findById(second.id);
    expect(secondUser?.role).toBe(Role.USER);
  });
});
