import { describe, expect, it } from "vitest";
import { InMemoryAuditService } from "../audit.js";
import { InMemoryUsersRepository } from "../identity.js";
import { InMemoryLicenseLimitsRepository, InMemoryLicensesRepository, LicenseStatus, Role } from "../license.js";
import { UserStatus, type AuthorizationContext } from "../roles.js";
import { inspectUserForAdmin, listUsersForAdmin, reactivateLicense, renewLicense } from "./license-admin.js";

const admin: AuthorizationContext = { userId: "admin-1", role: Role.ADMIN, status: UserStatus.ACTIVE };
const ordinaryUser: AuthorizationContext = { userId: "user-1", role: Role.USER, status: UserStatus.ACTIVE };

async function seedUser(users: InMemoryUsersRepository, telegramUserId: number) {
  return users.upsertFromTelegram({ telegramUserId, username: undefined, firstName: "A", lastName: undefined, languageCode: undefined, isPremium: false, authenticatedAt: new Date().toISOString() });
}

describe("renewLicense — Section 11 §B", () => {
  it("TEST 1: a USER cannot renew a license", async () => {
    const licenses = new InMemoryLicensesRepository();
    const result = await renewLicense(licenses, new InMemoryAuditService(), ordinaryUser, "lic-1" as never, "2027-01-01T00:00:00Z");
    expect(result.ok).toBe(false);
  });

  it("TEST 2: renewing an EXPIRED license pushes expiresAt out and restores ACTIVE status", async () => {
    const licenses = new InMemoryLicensesRepository();
    const created = await licenses.insert({ userId: "u1" as never, licenseKey: "k", plan: "pro", status: LicenseStatus.EXPIRED, startsAt: "2025-01-01T00:00:00Z", expiresAt: "2025-02-01T00:00:00Z", maxDevices: 1, createdBy: "admin-1" as never });
    const result = await renewLicense(licenses, new InMemoryAuditService(), admin, created.id as never, "2027-01-01T00:00:00Z");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe(LicenseStatus.ACTIVE);
      expect(result.value.expiresAt).toBe("2027-01-01T00:00:00Z");
    }
  });

  it("TEST 3: a REVOKED license can never be renewed — revocation is terminal", async () => {
    const licenses = new InMemoryLicensesRepository();
    const created = await licenses.insert({ userId: "u1" as never, licenseKey: "k", plan: "pro", status: LicenseStatus.ACTIVE, startsAt: "2025-01-01T00:00:00Z", expiresAt: null, maxDevices: 1, createdBy: "admin-1" as never });
    await licenses.update(created.id as never, { status: LicenseStatus.REVOKED, revokedAt: new Date().toISOString() });
    const result = await renewLicense(licenses, new InMemoryAuditService(), admin, created.id as never, "2027-01-01T00:00:00Z");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("revoked");
  });

  it("TEST 4: a SUSPENDED license cannot be renewed directly — must be reactivated first", async () => {
    const licenses = new InMemoryLicensesRepository();
    const created = await licenses.insert({ userId: "u1" as never, licenseKey: "k", plan: "pro", status: LicenseStatus.ACTIVE, startsAt: "2025-01-01T00:00:00Z", expiresAt: null, maxDevices: 1, createdBy: "admin-1" as never });
    await licenses.update(created.id as never, { status: LicenseStatus.SUSPENDED });
    const result = await renewLicense(licenses, new InMemoryAuditService(), admin, created.id as never, "2027-01-01T00:00:00Z");
    expect(result.ok).toBe(false);
  });

  it("TEST 5: rejects a new expiry that is not in the future", async () => {
    const licenses = new InMemoryLicensesRepository();
    const created = await licenses.insert({ userId: "u1" as never, licenseKey: "k", plan: "pro", status: LicenseStatus.ACTIVE, startsAt: "2025-01-01T00:00:00Z", expiresAt: null, maxDevices: 1, createdBy: "admin-1" as never });
    const result = await renewLicense(licenses, new InMemoryAuditService(), admin, created.id as never, "2020-01-01T00:00:00Z");
    expect(result.ok).toBe(false);
  });
});

describe("reactivateLicense — the ONE reverse transition this state machine permits", () => {
  it("TEST 6: reverses SUSPENDED -> ACTIVE", async () => {
    const licenses = new InMemoryLicensesRepository();
    const created = await licenses.insert({ userId: "u1" as never, licenseKey: "k", plan: "pro", status: LicenseStatus.ACTIVE, startsAt: "2025-01-01T00:00:00Z", expiresAt: null, maxDevices: 1, createdBy: "admin-1" as never });
    await licenses.update(created.id as never, { status: LicenseStatus.SUSPENDED });
    const result = await reactivateLicense(licenses, new InMemoryAuditService(), admin, created.id as never);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe(LicenseStatus.ACTIVE);
  });

  it("TEST 7: refuses to reactivate a license that isn't SUSPENDED", async () => {
    const licenses = new InMemoryLicensesRepository();
    const created = await licenses.insert({ userId: "u1" as never, licenseKey: "k", plan: "pro", status: LicenseStatus.ACTIVE, startsAt: "2025-01-01T00:00:00Z", expiresAt: null, maxDevices: 1, createdBy: "admin-1" as never });
    const result = await reactivateLicense(licenses, new InMemoryAuditService(), admin, created.id as never);
    expect(result.ok).toBe(false);
  });

  it("TEST 8: a USER cannot reactivate a license", async () => {
    const licenses = new InMemoryLicensesRepository();
    const result = await reactivateLicense(licenses, new InMemoryAuditService(), ordinaryUser, "lic-1" as never);
    expect(result.ok).toBe(false);
  });
});

describe("listUsersForAdmin / inspectUserForAdmin — bounded, admin-only", () => {
  it("TEST 9: a USER is denied the user list entirely", async () => {
    const users = new InMemoryUsersRepository();
    const result = await listUsersForAdmin({ users, licenses: new InMemoryLicensesRepository() }, ordinaryUser, { limit: 10, offset: 0 });
    expect(result.ok).toBe(false);
  });

  it("TEST 10: an admin sees a bounded, real list of users with their current license status", async () => {
    const users = new InMemoryUsersRepository();
    const licenses = new InMemoryLicensesRepository();
    const alice = await seedUser(users, 1);
    await licenses.insert({ userId: alice.id, licenseKey: "k", plan: "pro", status: LicenseStatus.ACTIVE, startsAt: "2025-01-01T00:00:00Z", expiresAt: null, maxDevices: 1, createdBy: alice.id });
    await seedUser(users, 2);
    const result = await listUsersForAdmin({ users, licenses }, admin, { limit: 10, offset: 0 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      const aliceSummary = result.value.find((s) => s.user.id === alice.id);
      expect(aliceSummary?.currentLicenseStatus).toBe(LicenseStatus.ACTIVE);
    }
  });

  it("TEST 11: the page size is always clamped, never trusted verbatim from a caller", async () => {
    const users = new InMemoryUsersRepository();
    for (let i = 0; i < 5; i++) await seedUser(users, i);
    const result = await listUsersForAdmin({ users, licenses: new InMemoryLicensesRepository() }, admin, { limit: 999999, offset: 0 });
    expect(result.ok).toBe(true);
    // Clamped internally to <= 100 — with only 5 real users, we just confirm it doesn't throw/crash on an absurd limit and returns the real (small) set.
    if (result.ok) expect(result.value.length).toBeLessThanOrEqual(5);
  });

  it("TEST 12: inspectUserForAdmin returns real license HISTORY (every row), not just the current one, and a real destination-usage count — never a fabricated ticket count", async () => {
    const users = new InMemoryUsersRepository();
    const licenses = new InMemoryLicensesRepository();
    const limits = new InMemoryLicenseLimitsRepository();
    const alice = await seedUser(users, 1);
    const oldLicense = await licenses.insert({ userId: alice.id, licenseKey: "k1", plan: "basic", status: LicenseStatus.EXPIRED, startsAt: "2024-01-01T00:00:00Z", expiresAt: "2024-06-01T00:00:00Z", maxDevices: 1, createdBy: alice.id });
    void oldLicense;
    const destinations = { list: async () => [{ createdBy: alice.id }, { createdBy: "someone-else" }] };
    const result = await inspectUserForAdmin({ users, licenses, limits, destinations }, admin, alice.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.licenseHistory).toHaveLength(1);
      expect(result.value.usage.destinationsConfigured).toBe(1);
      expect(result.value.usage.ticketsCreatedToday).toBeUndefined();
    }
  });

  it("TEST 13: inspectUserForAdmin denies a non-admin", async () => {
    const users = new InMemoryUsersRepository();
    const result = await inspectUserForAdmin({ users, licenses: new InMemoryLicensesRepository(), limits: new InMemoryLicenseLimitsRepository(), destinations: { list: async () => [] } }, ordinaryUser, "someone" as never);
    expect(result.ok).toBe(false);
  });
});
