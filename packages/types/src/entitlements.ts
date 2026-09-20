import type { ISODateString, Maybe, UUID } from "./common.js";

export const EntitlementSource = {
  PARTNER_AFFILIATE: "partner_affiliate",
  DIRECT_SUBSCRIPTION: "direct_subscription",
  NONE: "none",
} as const;
export type EntitlementSource = (typeof EntitlementSource)[keyof typeof EntitlementSource];

export const SubscriptionStatus = {
  ACTIVE: "active",
  TRIALING: "trialing",
  PAST_DUE: "past_due",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export interface SubscriptionPlan {
  readonly id: UUID;
  readonly name: string;
  readonly billingPeriodDays: number;
  readonly priceCents: number;
  readonly currency: string;
}

/** Payment provider is abstracted — see PaymentProvider interface in @tipstar/entitlements. */
export interface Subscription {
  readonly id: UUID;
  readonly userId: UUID;
  readonly planId: UUID;
  readonly status: SubscriptionStatus;
  readonly startedAt: ISODateString;
  readonly currentPeriodEnd: ISODateString;
  readonly cancelledAt: Maybe<ISODateString>;
  readonly paymentProviderId: string;
  readonly paymentProviderSubscriptionId: Maybe<string>;
}

/** A generic bookmaker/affiliate partner — never hard-coded to one bookmaker. */
export interface AffiliatePartner {
  readonly id: UUID;
  readonly name: string;
  readonly isActive: boolean;
}

export interface ReferralAttribution {
  readonly id: UUID;
  readonly userId: UUID;
  readonly partnerId: UUID;
  readonly referralCode: string;
  readonly campaign: Maybe<string>;
  readonly attributedAt: ISODateString;
  readonly convertedAt: Maybe<ISODateString>;
}

export interface Entitlement {
  readonly userId: UUID;
  readonly source: EntitlementSource;
  readonly isActive: boolean;
  readonly subscriptionId: Maybe<UUID>;
  readonly referralAttributionId: Maybe<UUID>;
  readonly effectiveUntil: Maybe<ISODateString>;
}
