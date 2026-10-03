import { PublishableContentType, type TelegramDestination } from "./types.js";

export interface PublishingDecision {
  readonly destinationId: string;
  readonly allowed: boolean;
  readonly reason: string;
}

/**
 * Publishing Policy Engine (Section 01 — PLATFORM). Deterministic
 * evaluation of whether a piece of content may be published to a given
 * destination, based purely on that destination's own configured flags —
 * it never decides WHAT to publish, only WHETHER a destination accepts a
 * given content type right now.
 */
export function evaluatePublishingPolicy(destination: TelegramDestination, contentType: PublishableContentType): PublishingDecision {
  if (!destination.enabled) {
    return { destinationId: destination.destinationId, allowed: false, reason: "Destination is disabled." };
  }
  if (!destination.autoPublish) {
    return { destinationId: destination.destinationId, allowed: false, reason: "Destination does not have auto-publish enabled." };
  }

  const flagByContentType: Record<PublishableContentType, boolean> = {
    [PublishableContentType.BOOKING_CODE]: destination.publishBookingCode,
    [PublishableContentType.TICKET]: destination.publishTicket,
    // An individual pick card is governed by the same destination flag as
    // a full ticket (§8's locked destination field list has no separate
    // "publish_pick" flag, and inventing one would be an unrelated
    // business field no section has asked for) — both are "prediction
    // content" from this destination's point of view, as opposed to
    // results/booking-code/weekly-report.
    [PublishableContentType.PICK]: destination.publishTicket,
    [PublishableContentType.RESULTS]: destination.publishResults,
    [PublishableContentType.WEEKLY_REPORT]: destination.publishWeeklyReport,
  };

  const allowed = flagByContentType[contentType];
  return {
    destinationId: destination.destinationId,
    allowed,
    reason: allowed ? "Destination accepts this content type." : `Destination does not accept "${contentType}" content.`,
  };
}

/** Evaluates every destination and returns only the ones currently allowed to receive this content. */
export function selectPublishableDestinations(
  destinations: readonly TelegramDestination[],
  contentType: PublishableContentType,
): readonly TelegramDestination[] {
  return destinations.filter((destination) => evaluatePublishingPolicy(destination, contentType).allowed);
}
