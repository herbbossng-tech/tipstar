import { evaluatePublishingPolicy } from "./publishing-policy.js";
import { TelegramDestinationVerificationStatus, type PublishableContentType, type TelegramDestination } from "./types.js";

/**
 * The richer Publishing Policy Engine (Section 10 §12/§13). Extends
 * (never replaces) `evaluatePublishingPolicy()`'s narrow destination-
 * flag check — this function calls it internally rather than
 * duplicating its logic. "Do NOT invent a confidence metric... use only
 * established backend fields" — every input here is a field this
 * codebase already has a real source for: `dataQuality` mirrors
 * `@sport-os/football-engine`'s `FeatureQuality` (`AVAILABLE`/`MISSING`/
 * `STALE`/`INVALID`), `modelAgreementRatio` mirrors `@sport-os/risk-
 * engine`'s `TicketRiskLimits.minimumModelAgreementRatio`/
 * `TicketRiskInput.modelAgreementRatio` exactly. There is no
 * "confidence" field anywhere in this policy.
 */

export const PublicationPolicyRejectionCode = {
  POLICY_DISABLED: "POLICY_DISABLED",
  MARKET_NOT_PERMITTED: "MARKET_NOT_PERMITTED",
  LEAGUE_NOT_PERMITTED: "LEAGUE_NOT_PERMITTED",
  DATA_QUALITY_TOO_LOW: "DATA_QUALITY_TOO_LOW",
  MODEL_AGREEMENT_TOO_LOW: "MODEL_AGREEMENT_TOO_LOW",
  DAILY_TICKET_LIMIT_REACHED: "DAILY_TICKET_LIMIT_REACHED",
  OUTSIDE_PUBLICATION_WINDOW: "OUTSIDE_PUBLICATION_WINDOW",
  ENTITLEMENT_MISSING: "ENTITLEMENT_MISSING",
  TICKET_INVALID: "TICKET_INVALID",
  TICKET_NOT_FINAL: "TICKET_NOT_FINAL",
  DESTINATION_DISABLED: "DESTINATION_DISABLED",
  DESTINATION_NOT_VERIFIED: "DESTINATION_NOT_VERIFIED",
  INTEGRATION_UNAVAILABLE: "INTEGRATION_UNAVAILABLE",
  /** Additive — §12's "accumulator/single restrictions", using the same reason-code pattern as every other rule here rather than overloading TICKET_INVALID. */
  ACCUMULATOR_NOT_PERMITTED: "ACCUMULATOR_NOT_PERMITTED",
  SINGLE_NOT_PERMITTED: "SINGLE_NOT_PERMITTED",
  /** Additive — §18/§75's "booking code does not exist: do not publish it according to policy." */
  BOOKING_CODE_UNAVAILABLE: "BOOKING_CODE_UNAVAILABLE",
} as const;
export type PublicationPolicyRejectionCode = (typeof PublicationPolicyRejectionCode)[keyof typeof PublicationPolicyRejectionCode];

export type PublicationMode = "manual" | "assisted" | "automatic";

/**
 * A versioned policy configuration — deliberately NOT a field on
 * `TelegramDestination` (§8 locks that type's field list; this is a
 * separate config object supplied alongside a publication request, the
 * same pattern Section 07's `DecisionPolicy`/`TicketRiskLimits` already
 * established for "policy is a parameter, not a row field").
 */
export interface PublicationPolicyConfig {
  readonly policyVersion: string;
  readonly enabled: boolean;
  /** `undefined` = no market restriction. */
  readonly permittedMarkets: readonly string[] | undefined;
  /** `undefined` = no league/competition restriction. Identifiers are the caller's own competition ids/names — this engine does not resolve them. */
  readonly permittedLeagues: readonly string[] | undefined;
  /** Real `FeatureQuality` values this policy still allows publishing for — `undefined` = no restriction. */
  readonly minimumDataQuality: readonly string[] | undefined;
  readonly minimumModelAgreementRatio: number | undefined;
  readonly maxPublicationsPerDay: number | undefined;
  readonly allowSingle: boolean;
  readonly allowAccumulator: boolean;
  /** UTC hour-of-day window, inclusive; `undefined` = no restriction. `startHourUtc <= endHourUtc` only — an overnight-wrapping window (e.g. 22-04) is not supported by this engine; see TELEGRAM_PUBLISHING_ARCHITECTURE.md's limitations. */
  readonly publicationWindow: { readonly startHourUtc: number; readonly endHourUtc: number } | undefined;
  readonly mode: PublicationMode;
  readonly publishSportAgentCards: boolean;
  readonly publishIndividualPicks: boolean;
}

/** The real, already-computed facts this engine evaluates against — never derived or guessed by this module itself. */
export interface PublicationCandidate {
  readonly ticketType: "SINGLE" | "ACCUMULATOR" | undefined;
  readonly markets: readonly string[];
  readonly leagues: readonly string[] | undefined;
  readonly worstDataQuality: string | undefined;
  readonly modelAgreementRatio: number | undefined;
  /** Whether the source record is in an appropriate finalized state (§51) — e.g. a ticket's status is EXECUTED/AUTHORIZED, never DRAFT. Computed upstream from the real Section 07 ticket status; this engine only reads the boolean. */
  readonly isFinal: boolean;
  readonly hasBookingCode: boolean;
}

export interface PublicationPolicyContext {
  readonly contentType: PublishableContentType;
  readonly destination: TelegramDestination;
  readonly policy: PublicationPolicyConfig;
  readonly candidate: PublicationCandidate;
  readonly hasEntitlement: boolean;
  /** How many publications of this type have already succeeded today for this destination — the caller's own count, never computed here. */
  readonly publicationsToday: number;
  readonly integrationAvailable: boolean;
  readonly now: Date;
}

export type PublicationPolicyResult = { readonly decision: "ALLOW" } | { readonly decision: "REJECT"; readonly code: PublicationPolicyRejectionCode; readonly reason: string };

/**
 * Deterministic, first-failure-wins evaluation (mirroring
 * `GlobalExecutionGate.authorize()`'s own "stop at the first denial"
 * pattern) — the same inputs always produce the same decision. Never
 * silently discards a publication: every REJECT carries an explicit
 * code and reason.
 */
export function evaluatePublicationPolicy(context: PublicationPolicyContext): PublicationPolicyResult {
  const { contentType, destination, policy, candidate, hasEntitlement, publicationsToday, integrationAvailable, now } = context;

  if (!hasEntitlement) {
    return reject(PublicationPolicyRejectionCode.ENTITLEMENT_MISSING, "This action requires a Telegram publishing entitlement.");
  }
  if (!policy.enabled) {
    return reject(PublicationPolicyRejectionCode.POLICY_DISABLED, "This publication policy is disabled.");
  }
  if (!destination.enabled) {
    return reject(PublicationPolicyRejectionCode.DESTINATION_DISABLED, "This destination is disabled.");
  }
  if (destination.verificationStatus !== TelegramDestinationVerificationStatus.VERIFIED) {
    return reject(PublicationPolicyRejectionCode.DESTINATION_NOT_VERIFIED, "This destination has not been verified.");
  }
  if (!integrationAvailable) {
    return reject(PublicationPolicyRejectionCode.INTEGRATION_UNAVAILABLE, "The Telegram publishing integration is currently unavailable.");
  }

  const isTicketShaped = contentType === "ticket" || contentType === "pick";
  if (isTicketShaped) {
    if (!candidate.isFinal) {
      return reject(PublicationPolicyRejectionCode.TICKET_NOT_FINAL, "The source ticket is not in a finalized state.");
    }
    if (candidate.markets.length === 0) {
      return reject(PublicationPolicyRejectionCode.TICKET_INVALID, "The source ticket has no legs to publish.");
    }
    if (candidate.ticketType === "SINGLE" && !policy.allowSingle) {
      return reject(PublicationPolicyRejectionCode.SINGLE_NOT_PERMITTED, "Single-ticket publication is not permitted by this policy.");
    }
    if (candidate.ticketType === "ACCUMULATOR" && !policy.allowAccumulator) {
      return reject(PublicationPolicyRejectionCode.ACCUMULATOR_NOT_PERMITTED, "Accumulator publication is not permitted by this policy.");
    }
    if (policy.permittedMarkets && candidate.markets.some((market) => !policy.permittedMarkets!.includes(market))) {
      return reject(PublicationPolicyRejectionCode.MARKET_NOT_PERMITTED, "One or more markets on this ticket are not permitted by this policy.");
    }
    if (policy.permittedLeagues && candidate.leagues && candidate.leagues.some((league) => !policy.permittedLeagues!.includes(league))) {
      return reject(PublicationPolicyRejectionCode.LEAGUE_NOT_PERMITTED, "One or more leagues on this ticket are not permitted by this policy.");
    }
    if (policy.minimumDataQuality && candidate.worstDataQuality !== undefined && !policy.minimumDataQuality.includes(candidate.worstDataQuality)) {
      return reject(PublicationPolicyRejectionCode.DATA_QUALITY_TOO_LOW, `Data quality "${candidate.worstDataQuality}" does not meet this policy's minimum.`);
    }
    if (policy.minimumModelAgreementRatio !== undefined && (candidate.modelAgreementRatio === undefined || candidate.modelAgreementRatio < policy.minimumModelAgreementRatio)) {
      return reject(PublicationPolicyRejectionCode.MODEL_AGREEMENT_TOO_LOW, "Model agreement does not meet this policy's minimum.");
    }
  }

  if (contentType === "booking_code" && !candidate.hasBookingCode) {
    return reject(PublicationPolicyRejectionCode.BOOKING_CODE_UNAVAILABLE, "No booking code exists for this ticket yet.");
  }

  if (contentType === "ticket" && !policy.publishSportAgentCards) {
    return reject(PublicationPolicyRejectionCode.POLICY_DISABLED, "Sport Agent Card publishing is disabled by this policy.");
  }
  if (contentType === "pick" && !policy.publishIndividualPicks) {
    return reject(PublicationPolicyRejectionCode.POLICY_DISABLED, "Individual pick publishing is disabled by this policy.");
  }

  if (policy.maxPublicationsPerDay !== undefined && publicationsToday >= policy.maxPublicationsPerDay) {
    return reject(PublicationPolicyRejectionCode.DAILY_TICKET_LIMIT_REACHED, "The daily publication limit has been reached.");
  }

  if (policy.publicationWindow) {
    const hour = now.getUTCHours();
    if (hour < policy.publicationWindow.startHourUtc || hour > policy.publicationWindow.endHourUtc) {
      return reject(PublicationPolicyRejectionCode.OUTSIDE_PUBLICATION_WINDOW, "This is outside the configured publication window.");
    }
  }

  const contentTypeDecision = evaluatePublishingPolicy(destination, contentType);
  if (!contentTypeDecision.allowed) {
    return reject(PublicationPolicyRejectionCode.DESTINATION_DISABLED, contentTypeDecision.reason);
  }

  return { decision: "ALLOW" };
}

function reject(code: PublicationPolicyRejectionCode, reason: string): PublicationPolicyResult {
  return { decision: "REJECT", code, reason };
}
