import {
  DatabaseLicenseService,
  Entitlement,
  InMemoryLicenseEntitlementsRepository,
  InMemoryLicenseLimitsRepository,
  InMemoryLicensesRepository,
  InMemoryUsersRepository,
  LicenseStatus,
  NotImplementedLicenseService,
  UserStatus,
  type License,
  type LicenseService,
} from "@sport-os/platform";
import type { UUID } from "@sport-os/shared";
import { describe, expect, it } from "vitest";
import { PublishingAuthorizer } from "./publishing-authorizer.js";

/**
 * `InMemoryLicensesRepository.insert()` always stores an empty
 * `entitlements` array (it never merges with `InMemoryLicenseEntitlementsRepository`
 * the way the real Supabase repository's `withEntitlements()` does) — a
 * known gap in that in-memory fake, not something this test should
 * route around with a full Supabase setup. This minimal fake
 * `LicenseService` instead returns a `License` whose `entitlements`
 * field is exactly what the test needs, so `licenseAllows()` sees the
 * real entitlement it's meant to check.
 */
class FakeLicenseServiceWithEntitlements extends NotImplementedLicenseService implements LicenseService {
  constructor(private readonly license: License) {
    super();
  }
  override async getLicenseForUser(): Promise<License | undefined> {
    return this.license;
  }
  override isLicenseActive(): boolean {
    return this.license.status === LicenseStatus.ACTIVE || this.license.status === LicenseStatus.TRIAL;
  }
}

function resolveTelegramAutoPublish(): Entitlement | undefined {
  return Entitlement.TELEGRAM_AUTO_PUBLISH;
}

describe("PublishingAuthorizer — Section 10 §31/§73 (never a second GlobalExecutionGate)", () => {
  it("TEST 1: denies at 'identity' for a completely unknown user — never falls through to license/entitlement", async () => {
    const authorizer = new PublishingAuthorizer({ users: new InMemoryUsersRepository(), licenseService: new DatabaseLicenseService(new InMemoryLicensesRepository(), new InMemoryLicenseEntitlementsRepository(), new InMemoryLicenseLimitsRepository()), resolveRequiredEntitlement: resolveTelegramAutoPublish });
    const result = await authorizer.authorize({ userId: "unknown-user" as UUID, agentType: "telegram_channel_management", action: "request_publication" });
    expect(result).toEqual({ authorized: false, failedCheck: "identity", reason: expect.any(String), code: "IDENTITY_UNKNOWN" });
  });

  it("TEST 2: denies at 'identity' for a SUSPENDED user even though they exist", async () => {
    const users = new InMemoryUsersRepository();
    const user = await users.upsertFromTelegram({ telegramUserId: 1, username: undefined, firstName: "A", lastName: undefined, languageCode: undefined, isPremium: false, authenticatedAt: new Date().toISOString() });
    await users.updateStatus(user.id, UserStatus.SUSPENDED);
    const authorizer = new PublishingAuthorizer({ users, licenseService: new DatabaseLicenseService(new InMemoryLicensesRepository(), new InMemoryLicenseEntitlementsRepository(), new InMemoryLicenseLimitsRepository()), resolveRequiredEntitlement: resolveTelegramAutoPublish });
    const result = await authorizer.authorize({ userId: user.id, agentType: "telegram_channel_management", action: "request_publication" });
    expect(result).toMatchObject({ authorized: false, failedCheck: "identity" });
  });

  it("TEST 3: denies at 'license' when the user has no license at all", async () => {
    const users = new InMemoryUsersRepository();
    const user = await users.upsertFromTelegram({ telegramUserId: 2, username: undefined, firstName: "A", lastName: undefined, languageCode: undefined, isPremium: false, authenticatedAt: new Date().toISOString() });
    const authorizer = new PublishingAuthorizer({ users, licenseService: new DatabaseLicenseService(new InMemoryLicensesRepository(), new InMemoryLicenseEntitlementsRepository(), new InMemoryLicenseLimitsRepository()), resolveRequiredEntitlement: resolveTelegramAutoPublish });
    const result = await authorizer.authorize({ userId: user.id, agentType: "telegram_channel_management", action: "request_publication" });
    expect(result).toMatchObject({ authorized: false, failedCheck: "license" });
  });

  it("TEST 4: denies at 'entitlement' when the license exists but lacks telegram_auto_publish", async () => {
    const users = new InMemoryUsersRepository();
    const user = await users.upsertFromTelegram({ telegramUserId: 3, username: undefined, firstName: "A", lastName: undefined, languageCode: undefined, isPremium: false, authenticatedAt: new Date().toISOString() });
    const licenses = new InMemoryLicensesRepository();
    await licenses.insert({ userId: user.id, licenseKey: "k", plan: "basic", status: LicenseStatus.ACTIVE, startsAt: new Date().toISOString(), expiresAt: null, maxDevices: 1, createdBy: user.id });
    const authorizer = new PublishingAuthorizer({ users, licenseService: new DatabaseLicenseService(licenses, new InMemoryLicenseEntitlementsRepository(), new InMemoryLicenseLimitsRepository()), resolveRequiredEntitlement: resolveTelegramAutoPublish });
    const result = await authorizer.authorize({ userId: user.id, agentType: "telegram_channel_management", action: "request_publication" });
    expect(result).toMatchObject({ authorized: false, failedCheck: "entitlement" });
  });

  it("TEST 5: authorizes once identity, license, and entitlement all pass — and runs no risk/integration_availability check (publishing is not execution)", async () => {
    const users = new InMemoryUsersRepository();
    const user = await users.upsertFromTelegram({ telegramUserId: 4, username: undefined, firstName: "A", lastName: undefined, languageCode: undefined, isPremium: false, authenticatedAt: new Date().toISOString() });
    const license: License = { userId: user.id, status: LicenseStatus.ACTIVE, role: user.role, entitlements: [Entitlement.TELEGRAM_AUTO_PUBLISH], issuedAt: new Date().toISOString(), expiresAt: null };
    const authorizer = new PublishingAuthorizer({ users, licenseService: new FakeLicenseServiceWithEntitlements(license), resolveRequiredEntitlement: resolveTelegramAutoPublish });
    const result = await authorizer.authorize({ userId: user.id, agentType: "telegram_channel_management", action: "request_publication" });
    expect(result).toEqual({ authorized: true });
  });

  it("TEST 6: an action resolving to no required entitlement is authorized once license alone is active", async () => {
    const users = new InMemoryUsersRepository();
    const user = await users.upsertFromTelegram({ telegramUserId: 5, username: undefined, firstName: "A", lastName: undefined, languageCode: undefined, isPremium: false, authenticatedAt: new Date().toISOString() });
    const licenses = new InMemoryLicensesRepository();
    await licenses.insert({ userId: user.id, licenseKey: "k", plan: "basic", status: LicenseStatus.ACTIVE, startsAt: new Date().toISOString(), expiresAt: null, maxDevices: 1, createdBy: user.id });
    const authorizer = new PublishingAuthorizer({ users, licenseService: new DatabaseLicenseService(licenses, new InMemoryLicenseEntitlementsRepository(), new InMemoryLicenseLimitsRepository()), resolveRequiredEntitlement: () => undefined });
    const result = await authorizer.authorize({ userId: user.id, agentType: "telegram_channel_management", action: "noop" });
    expect(result).toEqual({ authorized: true });
  });
});
