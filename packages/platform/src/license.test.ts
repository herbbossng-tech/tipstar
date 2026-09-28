import { describe, expect, it } from "vitest";
import { Entitlement, LicenseStatus, Role, licenseAllows, type License } from "./license.js";

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
