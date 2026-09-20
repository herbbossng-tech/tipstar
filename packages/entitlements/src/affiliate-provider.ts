/**
 * Abstracts a bookmaker/affiliate network so no single partner is hard-coded
 * into Tipstar (Section 17, Path A / Engineering Constitution).
 */
export interface AffiliateConversionEvent {
  readonly referralCode: string;
  readonly convertedAt: string;
}

export interface AffiliateProvider {
  readonly providerId: string;
  buildReferralLink(params: { readonly partnerId: string; readonly referralCode: string }): string;
  /** Verifies and parses an inbound conversion postback/webhook. */
  parseConversionEvent(rawBody: string, signatureHeader: string | undefined): AffiliateConversionEvent | null;
}

/** DEVELOPMENT-ONLY mock affiliate provider. Never wire into production. */
export class MockAffiliateProvider implements AffiliateProvider {
  readonly providerId = "mock";

  buildReferralLink(params: { readonly partnerId: string; readonly referralCode: string }): string {
    return `https://example-partner.example.com/ref/${params.partnerId}?code=${params.referralCode}`;
  }

  parseConversionEvent(): AffiliateConversionEvent | null {
    return null;
  }
}
