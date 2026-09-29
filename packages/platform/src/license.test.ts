import { describe, expect, it } from "vitest";
import { AuditOutcome, InMemoryAuditService } from "./audit.js";
import {
  assignEntitlement,
  checkLicenseLimit,
  createLicense,
  Entitlement,
  InMemoryLicenseEntitlementsRepository,
  InMemoryLicenseLimitsRepository,
  InMemoryLicensesRepository,
  isLicenseUsable,
  LicenseStatus,
  licenseAllows,
  removeEntitlement,
  revokeLicense,
  Role,
  setLicenseLimit,
  suspendLicense,
  updateLicense,
  type License,
} from "./license.js";
import { UserStatus, type AuthorizationContext } from "./roles.js";

function buildLicense(overrides: Partial<License> = {}): License {
  return {
    userId: "user-1",
    status: LicenseStatus.ACTIVE,
    role: Role.USER,
    entitlements: [Entitlement.FOOTBALL_ANALYSIS],
    issuedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: null,
    ...overrides,
  };
}

describe("licenseAllows", () => {
  it("allows an entitlement granted to an ACTIVE license", () => {
    expect(licenseAllows(buildLicense(), Entitlement.FOOTBALL_ANALYSIS)).toBe(true);
  });

  it("allows entitlements during TRIAL status too", () => {
    expect(licenseAllows(buildLicense({ status: LicenseStatus.TRIAL }), Entitlement.FOOTBALL_ANALYSIS)).toBe(true);
  });

  it("denies an entitlement the license does not carry", () => {
    expect(licenseAllows(buildLicense(), Entitlement.AVIATOR_AUTOMATION)).toBe(false);
  });

  it.each([LicenseStatus.SUSPENDED, LicenseStatus.EXPIRED, LicenseStatus.REVOKED])("denies every entitlement when status is %s", (status) => {
    expect(licenseAllows(buildLicense({ status }), Entitlement.FOOTBALL_ANALYSIS)).toBe(false);
  });

  it("denies an entitlement once the license has passed its expiresAt", () => {
    const license = buildLicense({ expiresAt: "2026-01-01T00:00:00.000Z" });
    const after = new Date("2026-06-01T00:00:00.000Z");
    expect(licenseAllows(license, Entitlement.FOOTBALL_ANALYSIS, after)).toBe(false);
  });

  it("allows an entitlement while still before expiresAt", () => {
    const license = buildLicense({ expiresAt: "2026-12-31T00:00:00.000Z" });
    const before = new Date("2026-06-01T00:00:00.000Z");
    expect(licenseAllows(license, Entitlement.FOOTBALL_ANALYSIS, before)).toBe(true);
  });

  it("a null expiresAt never expires", () => {
    expect(licenseAllows(buildLicense({ expiresAt: null }), Entitlement.FOOTBALL_ANALYSIS, new Date("2099-01-01"))).toBe(true);
  });
});

describe("isLicenseUsable — license validity", () => {
  it("accepts an ACTIVE license that has started and not expired", () => {
    const license = buildLicense({ status: LicenseStatus.ACTIVE, startsAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-12-31T00:00:00.000Z" });
    expect(isLicenseUsable(license, new Date("2026-06-01T00:00:00.000Z"))).toBe(true);
  });

  it("accepts a TRIAL license when valid", () => {
    expect(isLicenseUsable(buildLicense({ status: LicenseStatus.TRIAL }))).toBe(true);
  });

  it("rejects a SUSPENDED license", () => {
    expect(isLicenseUsable(buildLicense({ status: LicenseStatus.SUSPENDED }))).toBe(false);
  });

  it("rejects an EXPIRED license", () => {
    expect(isLicenseUsable(buildLicense({ status: LicenseStatus.EXPIRED }))).toBe(false);
  });

  it("rejects a REVOKED license", () => {
    expect(isLicenseUsable(buildLicense({ status: LicenseStatus.REVOKED }))).toBe(false);
  });

  it("rejects a license that has not started yet (future-start)", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const license = buildLicense({ status: LicenseStatus.ACTIVE, startsAt: "2026-06-01T00:00:00.000Z" });
    expect(isLicenseUsable(license, now)).toBe(false);
  });

  it("accepts once the start date has passed", () => {
    const license = buildLicense({ status: LicenseStatus.ACTIVE, startsAt: "2026-01-01T00:00:00.000Z" });
    expect(isLicenseUsable(license, new Date("2026-06-01T00:00:00.000Z"))).toBe(true);
  });

  it("a license with no startsAt has no start restriction (Section 01 backward compatibility)", () => {
    const license = buildLicense({ status: LicenseStatus.ACTIVE });
    expect(license.startsAt).toBeUndefined();
    expect(isLicenseUsable(license, new Date("2099-01-01"))).toBe(true);
  });
});

describe("checkLicenseLimit", () => {
  it("a null limit means unlimited", () => {
    expect(checkLicenseLimit(null, 1_000_000)).toBe(true);
  });

  it("usage under the limit is allowed", () => {
    expect(checkLicenseLimit(10, 9)).toBe(true);
  });

  it("usage at or over the limit is denied", () => {
    expect(checkLicenseLimit(10, 10)).toBe(false);
    expect(checkLicenseLimit(10, 11)).toBe(false);
  });
});

describe("license admin operations", () => {
  function actingAs(role: Role): AuthorizationContext {
    return { userId: "admin-1", role, status: UserStatus.ACTIVE };
  }

  it("createLicense requires admin authority", async () => {
    const licenses = new InMemoryLicensesRepository();
    const audit = new InMemoryAuditService();
    const result = await createLicense(licenses, audit, actingAs(Role.USER), {
      userId: "user-1",
      plan: "pro",
      status: LicenseStatus.ACTIVE,
      startsAt: new Date().toISOString(),
      expiresAt: null,
      maxDevices: null,
    });
    expect(result.ok).toBe(false);
  });

  it("createLicense succeeds for an admin and records an audit event", async () => {
    const licenses = new InMemoryLicensesRepository();
    const audit = new InMemoryAuditService();
    const result = await createLicense(licenses, audit, actingAs(Role.OWNER), {
      userId: "user-1",
      plan: "pro",
      status: LicenseStatus.ACTIVE,
      startsAt: new Date().toISOString(),
      expiresAt: null,
      maxDevices: null,
    });

    expect(result.ok).toBe(true);
    const event = audit.getEvents().find((e) => e.action === "license_created");
    expect(event?.outcome).toBe(AuditOutcome.SUCCESS);
  });

  it("a user cannot already have two active/trial licenses (InMemoryLicensesRepository enforces this like the DB unique index does)", async () => {
    const licenses = new InMemoryLicensesRepository();
    const audit = new InMemoryAuditService();
    const input = { userId: "user-1", plan: "pro", status: LicenseStatus.ACTIVE, startsAt: new Date().toISOString(), expiresAt: null, maxDevices: null };
    await createLicense(licenses, audit, actingAs(Role.OWNER), input);
    const second = await createLicense(licenses, audit, actingAs(Role.OWNER), input);
    expect(second.ok).toBe(false);
  });

  it("updateLicense/suspendLicense/revokeLicense all require admin authority and are audited", async () => {
    const licenses = new InMemoryLicensesRepository();
    const audit = new InMemoryAuditService();
    const created = await createLicense(licenses, audit, actingAs(Role.OWNER), {
      userId: "user-1",
      plan: "pro",
      status: LicenseStatus.ACTIVE,
      startsAt: new Date().toISOString(),
      expiresAt: null,
      maxDevices: null,
    });
    if (!created.ok) throw new Error("fixture setup failed");
    const licenseId = created.value.id as string;

    expect((await updateLicense(licenses, audit, actingAs(Role.USER), licenseId, { plan: "ultra" })).ok).toBe(false);
    expect((await suspendLicense(licenses, audit, actingAs(Role.USER), licenseId)).ok).toBe(false);
    expect((await revokeLicense(licenses, audit, actingAs(Role.USER), licenseId)).ok).toBe(false);

    const suspended = await suspendLicense(licenses, audit, actingAs(Role.ADMIN), licenseId);
    expect(suspended.ok).toBe(true);
    if (suspended.ok) expect(suspended.value.status).toBe(LicenseStatus.SUSPENDED);

    const revoked = await revokeLicense(licenses, audit, actingAs(Role.ADMIN), licenseId);
    expect(revoked.ok).toBe(true);
    if (revoked.ok) expect(revoked.value.status).toBe(LicenseStatus.REVOKED);

    expect(audit.getEvents().filter((e) => e.outcome === AuditOutcome.SUCCESS)).toHaveLength(3); // created, suspended, revoked
  });

  it("historical (revoked) licenses remain queryable, never deleted", async () => {
    const licenses = new InMemoryLicensesRepository();
    const audit = new InMemoryAuditService();
    const created = await createLicense(licenses, audit, actingAs(Role.OWNER), {
      userId: "user-1",
      plan: "pro",
      status: LicenseStatus.ACTIVE,
      startsAt: new Date().toISOString(),
      expiresAt: null,
      maxDevices: null,
    });
    if (!created.ok) throw new Error("fixture setup failed");
    await revokeLicense(licenses, audit, actingAs(Role.OWNER), created.value.id as string);

    const stillThere = await licenses.getById(created.value.id as string);
    expect(stillThere).toBeDefined();
    expect(stillThere?.status).toBe(LicenseStatus.REVOKED);
  });

  it("assignEntitlement/removeEntitlement require admin authority and are data-driven, not plan-inferred", async () => {
    const entitlements = new InMemoryLicenseEntitlementsRepository();
    const audit = new InMemoryAuditService();
    const licenseId = "license-1";

    expect((await assignEntitlement(entitlements, audit, actingAs(Role.USER), licenseId, Entitlement.FOOTBALL_AUTOMATION)).ok).toBe(false);

    const assigned = await assignEntitlement(entitlements, audit, actingAs(Role.ADMIN), licenseId, Entitlement.FOOTBALL_AUTOMATION);
    expect(assigned.ok).toBe(true);
    expect(await entitlements.listEnabledForLicense(licenseId)).toContain(Entitlement.FOOTBALL_AUTOMATION);

    const removed = await removeEntitlement(entitlements, audit, actingAs(Role.ADMIN), licenseId, Entitlement.FOOTBALL_AUTOMATION);
    expect(removed.ok).toBe(true);
    expect(await entitlements.listEnabledForLicense(licenseId)).not.toContain(Entitlement.FOOTBALL_AUTOMATION);
  });

  it("setLicenseLimit requires admin authority", async () => {
    const limits = new InMemoryLicenseLimitsRepository();
    const audit = new InMemoryAuditService();
    const licenseId = "license-1";

    expect((await setLicenseLimit(limits, audit, actingAs(Role.USER), licenseId, { maxTicketsPerDay: 5 })).ok).toBe(false);

    const result = await setLicenseLimit(limits, audit, actingAs(Role.ADMIN), licenseId, { maxTicketsPerDay: 5 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.maxTicketsPerDay).toBe(5);
  });
});
