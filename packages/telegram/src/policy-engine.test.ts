import { describe, expect, it } from "vitest";
import { evaluatePublicationPolicy, PublicationPolicyRejectionCode, type PublicationCandidate, type PublicationPolicyConfig, type PublicationPolicyContext } from "./policy-engine.js";
import { PublishableContentType, TelegramDestinationType, TelegramDestinationVerificationStatus, type TelegramDestination } from "./types.js";

function destination(overrides: Partial<TelegramDestination> = {}): TelegramDestination {
  return {
    destinationId: "d1",
    telegramChatId: "-1001",
    name: "Main",
    type: TelegramDestinationType.CHANNEL,
    enabled: true,
    autoPublish: true,
    publishBookingCode: true,
    publishTicket: true,
    publishResults: true,
    publishWeeklyReport: true,
    createdAt: "2026-01-01T00:00:00Z",
    verificationStatus: TelegramDestinationVerificationStatus.VERIFIED,
    ...overrides,
  };
}

function policy(overrides: Partial<PublicationPolicyConfig> = {}): PublicationPolicyConfig {
  return {
    policyVersion: "v1",
    enabled: true,
    permittedMarkets: undefined,
    permittedLeagues: undefined,
    minimumDataQuality: undefined,
    minimumModelAgreementRatio: undefined,
    maxPublicationsPerDay: undefined,
    allowSingle: true,
    allowAccumulator: true,
    publicationWindow: undefined,
    mode: "automatic",
    publishSportAgentCards: true,
    publishIndividualPicks: true,
    ...overrides,
  };
}

function candidate(overrides: Partial<PublicationCandidate> = {}): PublicationCandidate {
  return { ticketType: "SINGLE", markets: ["match_result_1x2"], leagues: ["epl"], worstDataQuality: "AVAILABLE", modelAgreementRatio: 0.9, isFinal: true, hasBookingCode: true, ...overrides };
}

function context(overrides: Partial<PublicationPolicyContext> = {}): PublicationPolicyContext {
  return {
    contentType: PublishableContentType.TICKET,
    destination: destination(),
    policy: policy(),
    candidate: candidate(),
    hasEntitlement: true,
    publicationsToday: 0,
    integrationAvailable: true,
    now: new Date("2026-06-01T12:00:00Z"),
    ...overrides,
  };
}

describe("evaluatePublicationPolicy — Section 10 §12/§13", () => {
  it("TEST 1: ALLOWs a fully valid, finalized single ticket", () => {
    expect(evaluatePublicationPolicy(context()).decision).toBe("ALLOW");
  });

  it("TEST 2: REJECTs with ENTITLEMENT_MISSING when the caller lacks the entitlement", () => {
    const result = evaluatePublicationPolicy(context({ hasEntitlement: false }));
    expect(result).toEqual({ decision: "REJECT", code: PublicationPolicyRejectionCode.ENTITLEMENT_MISSING, reason: expect.any(String) });
  });

  it("TEST 3: REJECTs with POLICY_DISABLED when the policy itself is disabled", () => {
    const result = evaluatePublicationPolicy(context({ policy: policy({ enabled: false }) }));
    expect(result).toMatchObject({ decision: "REJECT", code: PublicationPolicyRejectionCode.POLICY_DISABLED });
  });

  it("TEST 4: REJECTs with DESTINATION_DISABLED when the destination is disabled", () => {
    const result = evaluatePublicationPolicy(context({ destination: destination({ enabled: false }) }));
    expect(result).toMatchObject({ decision: "REJECT", code: PublicationPolicyRejectionCode.DESTINATION_DISABLED });
  });

  it("TEST 5: REJECTs with DESTINATION_NOT_VERIFIED when the destination was never verified — never treats UNVERIFIED as good enough", () => {
    const result = evaluatePublicationPolicy(context({ destination: destination({ verificationStatus: TelegramDestinationVerificationStatus.UNVERIFIED }) }));
    expect(result).toMatchObject({ decision: "REJECT", code: PublicationPolicyRejectionCode.DESTINATION_NOT_VERIFIED });
  });

  it("TEST 6: REJECTs with DESTINATION_NOT_VERIFIED when verification previously FAILED", () => {
    const result = evaluatePublicationPolicy(context({ destination: destination({ verificationStatus: TelegramDestinationVerificationStatus.FAILED }) }));
    expect(result).toMatchObject({ decision: "REJECT", code: PublicationPolicyRejectionCode.DESTINATION_NOT_VERIFIED });
  });

  it("TEST 7: REJECTs with INTEGRATION_UNAVAILABLE when the Telegram integration itself is unavailable", () => {
    const result = evaluatePublicationPolicy(context({ integrationAvailable: false }));
    expect(result).toMatchObject({ decision: "REJECT", code: PublicationPolicyRejectionCode.INTEGRATION_UNAVAILABLE });
  });

  it("TEST 8: REJECTs with TICKET_NOT_FINAL when the source ticket is not finalized — never infers finality from frontend state", () => {
    const result = evaluatePublicationPolicy(context({ candidate: candidate({ isFinal: false }) }));
    expect(result).toMatchObject({ decision: "REJECT", code: PublicationPolicyRejectionCode.TICKET_NOT_FINAL });
  });

  it("TEST 9: REJECTs with TICKET_INVALID when the ticket has no legs", () => {
    const result = evaluatePublicationPolicy(context({ candidate: candidate({ markets: [] }) }));
    expect(result).toMatchObject({ decision: "REJECT", code: PublicationPolicyRejectionCode.TICKET_INVALID });
  });

  it("TEST 10: REJECTs with SINGLE_NOT_PERMITTED when policy disallows singles", () => {
    const result = evaluatePublicationPolicy(context({ policy: policy({ allowSingle: false }), candidate: candidate({ ticketType: "SINGLE" }) }));
    expect(result).toMatchObject({ decision: "REJECT", code: PublicationPolicyRejectionCode.SINGLE_NOT_PERMITTED });
  });

  it("TEST 11: REJECTs with ACCUMULATOR_NOT_PERMITTED when policy disallows accumulators", () => {
    const result = evaluatePublicationPolicy(context({ policy: policy({ allowAccumulator: false }), candidate: candidate({ ticketType: "ACCUMULATOR" }) }));
    expect(result).toMatchObject({ decision: "REJECT", code: PublicationPolicyRejectionCode.ACCUMULATOR_NOT_PERMITTED });
  });

  it("TEST 12: REJECTs with MARKET_NOT_PERMITTED when a leg's market is outside the permitted list", () => {
    const result = evaluatePublicationPolicy(context({ policy: policy({ permittedMarkets: ["over_under"] }), candidate: candidate({ markets: ["match_result_1x2"] }) }));
    expect(result).toMatchObject({ decision: "REJECT", code: PublicationPolicyRejectionCode.MARKET_NOT_PERMITTED });
  });

  it("TEST 13: REJECTs with LEAGUE_NOT_PERMITTED when a leg's league is outside the permitted list", () => {
    const result = evaluatePublicationPolicy(context({ policy: policy({ permittedLeagues: ["laliga"] }), candidate: candidate({ leagues: ["epl"] }) }));
    expect(result).toMatchObject({ decision: "REJECT", code: PublicationPolicyRejectionCode.LEAGUE_NOT_PERMITTED });
  });

  it("TEST 14: REJECTs with DATA_QUALITY_TOO_LOW when worst data quality is below the policy minimum", () => {
    const result = evaluatePublicationPolicy(context({ policy: policy({ minimumDataQuality: ["AVAILABLE"] }), candidate: candidate({ worstDataQuality: "STALE" }) }));
    expect(result).toMatchObject({ decision: "REJECT", code: PublicationPolicyRejectionCode.DATA_QUALITY_TOO_LOW });
  });

  it("TEST 15: REJECTs with MODEL_AGREEMENT_TOO_LOW when model agreement is below the policy minimum — never a 'confidence' field", () => {
    const result = evaluatePublicationPolicy(context({ policy: policy({ minimumModelAgreementRatio: 0.8 }), candidate: candidate({ modelAgreementRatio: 0.5 }) }));
    expect(result).toMatchObject({ decision: "REJECT", code: PublicationPolicyRejectionCode.MODEL_AGREEMENT_TOO_LOW });
  });

  it("TEST 16: REJECTs with BOOKING_CODE_UNAVAILABLE when no booking code exists yet — never fabricates one", () => {
    const result = evaluatePublicationPolicy(context({ contentType: PublishableContentType.BOOKING_CODE, candidate: candidate({ hasBookingCode: false }) }));
    expect(result).toMatchObject({ decision: "REJECT", code: PublicationPolicyRejectionCode.BOOKING_CODE_UNAVAILABLE });
  });

  it("TEST 17: ALLOWs a booking_code publication once a real booking code exists", () => {
    const result = evaluatePublicationPolicy(context({ contentType: PublishableContentType.BOOKING_CODE, candidate: candidate({ hasBookingCode: true }) }));
    expect(result.decision).toBe("ALLOW");
  });

  it("TEST 18: REJECTs a Sport Agent Card (ticket) publication when the policy disables it", () => {
    const result = evaluatePublicationPolicy(context({ policy: policy({ publishSportAgentCards: false }) }));
    expect(result).toMatchObject({ decision: "REJECT", code: PublicationPolicyRejectionCode.POLICY_DISABLED });
  });

  it("TEST 19: REJECTs an individual pick publication when the policy disables it", () => {
    const result = evaluatePublicationPolicy(context({ contentType: PublishableContentType.PICK, policy: policy({ publishIndividualPicks: false }) }));
    expect(result).toMatchObject({ decision: "REJECT", code: PublicationPolicyRejectionCode.POLICY_DISABLED });
  });

  it("TEST 20: REJECTs with DAILY_TICKET_LIMIT_REACHED once today's count meets the configured maximum", () => {
    const result = evaluatePublicationPolicy(context({ policy: policy({ maxPublicationsPerDay: 3 }), publicationsToday: 3 }));
    expect(result).toMatchObject({ decision: "REJECT", code: PublicationPolicyRejectionCode.DAILY_TICKET_LIMIT_REACHED });
  });

  it("TEST 21: ALLOWs when today's count is still below the configured maximum", () => {
    const result = evaluatePublicationPolicy(context({ policy: policy({ maxPublicationsPerDay: 3 }), publicationsToday: 2 }));
    expect(result.decision).toBe("ALLOW");
  });

  it("TEST 22: REJECTs with OUTSIDE_PUBLICATION_WINDOW outside the configured UTC hour window", () => {
    const result = evaluatePublicationPolicy(context({ policy: policy({ publicationWindow: { startHourUtc: 8, endHourUtc: 10 } }), now: new Date("2026-06-01T23:00:00Z") }));
    expect(result).toMatchObject({ decision: "REJECT", code: PublicationPolicyRejectionCode.OUTSIDE_PUBLICATION_WINDOW });
  });

  it("TEST 23: ALLOWs inside the configured UTC hour window", () => {
    const result = evaluatePublicationPolicy(context({ policy: policy({ publicationWindow: { startHourUtc: 8, endHourUtc: 20 } }), now: new Date("2026-06-01T12:00:00Z") }));
    expect(result.decision).toBe("ALLOW");
  });

  it("TEST 24: REJECTs via the always-run destination content-type flag, even when every richer check would ALLOW", () => {
    const result = evaluatePublicationPolicy(context({ destination: destination({ publishTicket: false }) }));
    expect(result).toMatchObject({ decision: "REJECT", code: PublicationPolicyRejectionCode.DESTINATION_DISABLED });
  });
});
