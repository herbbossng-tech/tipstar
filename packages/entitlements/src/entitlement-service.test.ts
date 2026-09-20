import { describe, expect, it } from "vitest";
import { SubscriptionStatus, type ReferralAttribution, type Subscription } from "@tipstar/types";
import { resolveEntitlement } from "./entitlement-service.js";
import { hasPermission, Permission } from "./roles.js";
import { UserRole } from "@tipstar/types";

describe("resolveEntitlement", () => {
  const now = new Date("2026-06-01T00:00:00Z");

  it("grants entitlement via converted affiliate attribution", () => {
    const referral: ReferralAttribution = {
      id: "ref-1",
      userId: "user-1",
      partnerId: "partner-1",
      referralCode: "CODE1",
      campaign: null,
      attributedAt: "2026-01-01T00:00:00Z",
      convertedAt: "2026-01-02T00:00:00Z",
    };
    const entitlement = resolveEntitlement("user-1", null, referral, now);
    expect(entitlement.isActive).toBe(true);
    expect(entitlement.source).toBe("partner_affiliate");
  });

  it("grants entitlement via an active, unexpired subscription", () => {
    const sub: Subscription = {
      id: "sub-1",
      userId: "user-1",
      planId: "plan-1",
      status: SubscriptionStatus.ACTIVE,
      startedAt: "2026-05-01T00:00:00Z",
      currentPeriodEnd: "2026-07-01T00:00:00Z",
      cancelledAt: null,
      paymentProviderId: "mock",
      paymentProviderSubscriptionId: "mock-sub-1",
    };
    const entitlement = resolveEntitlement("user-1", sub, null, now);
    expect(entitlement.isActive).toBe(true);
    expect(entitlement.source).toBe("direct_subscription");
  });

  it("denies entitlement when subscription has expired and there is no affiliate attribution", () => {
    const sub: Subscription = {
      id: "sub-1",
      userId: "user-1",
      planId: "plan-1",
      status: SubscriptionStatus.EXPIRED,
      startedAt: "2026-01-01T00:00:00Z",
      currentPeriodEnd: "2026-02-01T00:00:00Z",
      cancelledAt: null,
      paymentProviderId: "mock",
      paymentProviderSubscriptionId: "mock-sub-1",
    };
    const entitlement = resolveEntitlement("user-1", sub, null, now);
    expect(entitlement.isActive).toBe(false);
    expect(entitlement.source).toBe("none");
  });
});

describe("hasPermission", () => {
  it("grants a plain user free-pick viewing but not premium pick publishing", () => {
    expect(hasPermission([UserRole.USER], Permission.VIEW_FREE_PICKS)).toBe(true);
    expect(hasPermission([UserRole.USER], Permission.PUBLISH_PICKS)).toBe(false);
  });

  it("grants an admin publish/correct permissions", () => {
    expect(hasPermission([UserRole.ADMIN], Permission.PUBLISH_PICKS)).toBe(true);
    expect(hasPermission([UserRole.ADMIN], Permission.CORRECT_PICKS)).toBe(true);
  });
});
