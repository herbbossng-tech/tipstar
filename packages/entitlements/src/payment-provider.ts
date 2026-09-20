import type { ISODateString } from "@tipstar/types";

export interface CheckoutSession {
  readonly sessionId: string;
  readonly checkoutUrl: string;
}

export interface PaymentEvent {
  readonly providerSubscriptionId: string;
  readonly type: "activated" | "renewed" | "cancelled" | "payment_failed";
  readonly occurredAt: ISODateString;
}

/**
 * Abstracts the billing vendor for direct premium subscriptions (Section
 * 17, Path B). No vendor-specific logic may leak outside an implementation
 * of this interface.
 */
export interface PaymentProvider {
  readonly providerId: string;
  createCheckoutSession(params: { readonly userId: string; readonly planId: string }): Promise<CheckoutSession>;
  cancelSubscription(providerSubscriptionId: string): Promise<void>;
  /** Verifies and parses an inbound webhook payload/signature into a normalized event. */
  parseWebhookEvent(rawBody: string, signatureHeader: string | undefined): PaymentEvent | null;
}

/** DEVELOPMENT-ONLY mock payment provider. Never wire into production billing. */
export class MockPaymentProvider implements PaymentProvider {
  readonly providerId = "mock";

  async createCheckoutSession(params: { readonly userId: string; readonly planId: string }): Promise<CheckoutSession> {
    return { sessionId: `mock-session-${params.userId}-${params.planId}`, checkoutUrl: "https://example.com/mock-checkout" };
  }

  async cancelSubscription(): Promise<void> {
    return;
  }

  parseWebhookEvent(): PaymentEvent | null {
    return null;
  }
}
