import { EntitlementSource, SubscriptionStatus, type Entitlement, type ReferralAttribution, type Subscription, type UUID } from "@tipstar/types";

/**
 * Resolves a user's effective entitlement from the two monetization paths
 * (Section 17): an active partner/affiliate attribution, or an active
 * direct subscription. Partner attribution is checked first since it
 * reflects a bookmaker-partnership agreement already in effect; either path
 * independently grants access.
 */
export function resolveEntitlement(
  userId: UUID,
  subscription: Subscription | null,
  referralAttribution: ReferralAttribution | null,
  now: Date = new Date(),
): Entitlement {
  const affiliateActive = referralAttribution !== null && referralAttribution.convertedAt !== null;
  if (affiliateActive && referralAttribution) {
    return {
      userId,
      source: EntitlementSource.PARTNER_AFFILIATE,
      isActive: true,
      subscriptionId: null,
      referralAttributionId: referralAttribution.id,
      effectiveUntil: null,
    };
  }

  const subscriptionActive =
    subscription !== null &&
    (subscription.status === SubscriptionStatus.ACTIVE || subscription.status === SubscriptionStatus.TRIALING) &&
    new Date(subscription.currentPeriodEnd).getTime() > now.getTime();

  if (subscriptionActive && subscription) {
    return {
      userId,
      source: EntitlementSource.DIRECT_SUBSCRIPTION,
      isActive: true,
      subscriptionId: subscription.id,
      referralAttributionId: null,
      effectiveUntil: subscription.currentPeriodEnd,
    };
  }

  return {
    userId,
    source: EntitlementSource.NONE,
    isActive: false,
    subscriptionId: subscription?.id ?? null,
    referralAttributionId: referralAttribution?.id ?? null,
    effectiveUntil: null,
  };
}
