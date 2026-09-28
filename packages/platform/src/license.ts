import { NotImplementedError, type ISODateString, type UUID } from "@sport-os/shared";

export const LicenseStatus = {
  TRIAL: "trial",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  EXPIRED: "expired",
  REVOKED: "revoked",
} as const;
export type LicenseStatus = (typeof LicenseStatus)[keyof typeof LicenseStatus];

export const Role = {
  OWNER: "owner",
  ADMIN: "admin",
  USER: "user",
} as const;
export type Role = (typeof Role)[keyof typeof Role];

/** Future feature entitlements (Section 01 — Licensing Foundation). */
export const Entitlement = {
  FOOTBALL_ANALYSIS: "football_analysis",
  FOOTBALL_TICKETS: "football_tickets",
  FOOTBALL_AUTOMATION: "football_automation",
  AVIATOR_ANALYSIS: "aviator_analysis",
  AVIATOR_AUTOMATION: "aviator_automation",
  TELEGRAM_AUTO_PUBLISH: "telegram_auto_publish",
  TELEGRAM_MULTI_CHANNEL: "telegram_multi_channel",
  WEEKLY_REPORTS: "weekly_reports",
  ADVANCED_ANALYTICS: "advanced_analytics",
} as const;
export type Entitlement = (typeof Entitlement)[keyof typeof Entitlement];

/** Statuses that are permitted to exercise entitlements at all. */
const LICENSE_STATUSES_IN_GOOD_STANDING: readonly LicenseStatus[] = [LicenseStatus.TRIAL, LicenseStatus.ACTIVE];

export interface License {
  readonly userId: UUID;
  readonly status: LicenseStatus;
  readonly role: Role;
  readonly entitlements: readonly Entitlement[];
  readonly issuedAt: ISODateString;
  readonly expiresAt: ISODateString | null;
}

/**
 * Pure decision rule: does this license currently grant the given
 * entitlement? This is the foundation-level enforcement contract Section
 * 01 asks for — real production enforcement (wiring this into every
 * request path against persisted license data) is a later-section
 * concern, but the rule itself is genuine, not a placeholder.
 */
export function licenseAllows(license: License, entitlement: Entitlement, now: Date = new Date()): boolean {
  if (!LICENSE_STATUSES_IN_GOOD_STANDING.includes(license.status)) return false;
  if (license.expiresAt !== null && new Date(license.expiresAt).getTime() <= now.getTime()) return false;
  return license.entitlements.includes(entitlement);
}

/**
 * LicenseService — resolves a user's current license. Deferred: requires
 * persistence, a Section 03 (database) concern. `licenseAllows` above is
 * usable against any License object today, independent of where it came
 * from.
 */
export interface LicenseService {
  getLicense(userId: string): Promise<License | undefined>;
  hasEntitlement(userId: string, entitlement: Entitlement): Promise<boolean>;
}

export class NotImplementedLicenseService implements LicenseService {
  async getLicense(_userId: string): Promise<License | undefined> {
    throw new NotImplementedError("LicenseService.getLicense");
  }
  async hasEntitlement(_userId: string, _entitlement: Entitlement): Promise<boolean> {
    throw new NotImplementedError("LicenseService.hasEntitlement");
  }
}
