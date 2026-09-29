import { describe, expect, it } from "vitest";
import { AuditOutcome, InMemoryAuditService } from "./audit.js";
import { InMemoryUsersRepository } from "./identity.js";
import { Role } from "./license.js";
import { bootstrapOwner, InMemoryPlatformSettingsRepository } from "./owner-bootstrap.js";

const SECRET = "test-owner-bootstrap-secret-do-not-use-in-production";

/** Wires the in-memory settings repo's claim callback to actually promote via the users repo, mirroring how the real `claim_owner_bootstrap` SQL function promotes inside the same atomic operation as the claim. */
function makeSettings(users: InMemoryUsersRepository): InMemoryPlatformSettingsRepository {
  return new InMemoryPlatformSettingsRepository(async (userId) => {
    await users.updateRole(userId, Role.OWNER);
  });
}

describe("bootstrapOwner", () => {
  it("fails closed (not configured) when no secret is configured at all", async () => {
    const users = new InMemoryUsersRepository();
    const settings = makeSettings(users);
    const audit = new InMemoryAuditService();
    await users.upsertFromTelegram({ telegramUserId: 1, username: undefined, firstName: "A", lastName: undefined, languageCode: undefined, isPremium: false, authenticatedAt: new Date().toISOString() });

    const result = await bootstrapOwner(users, settings, audit, { telegramUserId: 1, providedSecret: "anything", configuredSecret: undefined });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("OWNER_BOOTSTRAP_NOT_CONFIGURED");
  });

  it("rejects an incorrect secret", async () => {
    const users = new InMemoryUsersRepository();
    const settings = makeSettings(users);
    const audit = new InMemoryAuditService();
    await users.upsertFromTelegram({ telegramUserId: 1, username: undefined, firstName: "A", lastName: undefined, languageCode: undefined, isPremium: false, authenticatedAt: new Date().toISOString() });

    const result = await bootstrapOwner(users, settings, audit, { telegramUserId: 1, providedSecret: "wrong-secret", configuredSecret: SECRET });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("OWNER_BOOTSTRAP_SECRET_INVALID");
  });

  it("fails when the target Telegram user has never authenticated (no users row)", async () => {
    const users = new InMemoryUsersRepository();
    const settings = makeSettings(users);
    const audit = new InMemoryAuditService();

    const result = await bootstrapOwner(users, settings, audit, { telegramUserId: 999, providedSecret: SECRET, configuredSecret: SECRET });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("OWNER_BOOTSTRAP_USER_NOT_FOUND");
  });

  it("promotes the user to OWNER, marks the platform bootstrapped, and records an audit event", async () => {
    const users = new InMemoryUsersRepository();
    const settings = makeSettings(users);
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
    const settings = makeSettings(users);
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

  it("regression: the one-time claim invariant — only the FIRST of several concurrent-style calls against the same settings instance can ever claim it", async () => {
    // Simulates the race the fix addresses: several callers all racing to
    // claim the same one-time slot. claimAndPromoteOwner's check-then-set
    // runs with no intervening await (mirroring the real atomic UPDATE's
    // row-lock semantics), so even when every call is issued "concurrently"
    // (Promise.all, no sequential awaiting), exactly one may succeed.
    const users = new InMemoryUsersRepository();
    const settings = makeSettings(users);
    const targets = await Promise.all(
      [1, 2, 3, 4, 5].map((telegramUserId) =>
        users.upsertFromTelegram({ telegramUserId, username: undefined, firstName: "A", lastName: undefined, languageCode: undefined, isPremium: false, authenticatedAt: new Date().toISOString() }),
      ),
    );

    const claims = await Promise.all(targets.map((user) => settings.claimAndPromoteOwner(user.id)));

    expect(claims.filter(Boolean)).toHaveLength(1);
    const promotedCount = (await Promise.all(targets.map((user) => users.findById(user.id)))).filter((u) => u?.role === Role.OWNER).length;
    expect(promotedCount).toBe(1);

    // A later attempt, after all of the above, must also deterministically fail.
    const audit = new InMemoryAuditService();
    const late = await bootstrapOwner(users, settings, audit, { telegramUserId: targets[0]!.telegramUserId, providedSecret: SECRET, configuredSecret: SECRET });
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.error.code).toBe("OWNER_BOOTSTRAP_ALREADY_DONE");
  });

  it("regression: a failed promotion rolls back the claim — the slot is NOT consumed, and a subsequent valid attempt on the SAME repository instance can still claim it", async () => {
    // Mirrors the real claim_owner_bootstrap Postgres function's
    // rollback semantics: the claim and the promotion are one coherent
    // operation, so a promotion failure must leave the slot unclaimed,
    // never permanently (and wrongly) consumed with nobody promoted.
    const users = new InMemoryUsersRepository();
    let userIdThatShouldFailPromotion: string | undefined;
    const settings = new InMemoryPlatformSettingsRepository(async (userId) => {
      if (userId === userIdThatShouldFailPromotion) {
        throw new Error("simulated promotion failure");
      }
      await users.updateRole(userId, Role.OWNER);
    });
    const failing = await users.upsertFromTelegram({ telegramUserId: 1, username: undefined, firstName: "A", lastName: undefined, languageCode: undefined, isPremium: false, authenticatedAt: new Date().toISOString() });
    userIdThatShouldFailPromotion = failing.id;

    await expect(settings.claimAndPromoteOwner(failing.id)).rejects.toThrow("simulated promotion failure");
    expect(await settings.isOwnerBootstrapped()).toBe(false);

    // A subsequent, genuinely successful attempt — on the SAME repository
    // instance — must still be able to claim.
    const succeeding = await users.upsertFromTelegram({ telegramUserId: 2, username: undefined, firstName: "B", lastName: undefined, languageCode: undefined, isPremium: false, authenticatedAt: new Date().toISOString() });
    const claimed = await settings.claimAndPromoteOwner(succeeding.id);
    expect(claimed).toBe(true);
    expect(await settings.isOwnerBootstrapped()).toBe(true);
    const promoted = await users.findById(succeeding.id);
    expect(promoted?.role).toBe(Role.OWNER);
  });
});
