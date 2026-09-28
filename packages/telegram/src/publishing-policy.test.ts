import { describe, expect, it } from "vitest";
import { PublishableContentType, TelegramDestinationType, type TelegramDestination } from "./types.js";
import { evaluatePublishingPolicy, selectPublishableDestinations } from "./publishing-policy.js";

function buildDestination(overrides: Partial<TelegramDestination> = {}): TelegramDestination {
  return {
    destinationId: "dest-1",
    telegramChatId: "-1001234567890",
    name: "Main Channel",
    type: TelegramDestinationType.CHANNEL,
    enabled: true,
    autoPublish: true,
    publishBookingCode: true,
    publishTicket: true,
    publishResults: false,
    publishWeeklyReport: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("evaluatePublishingPolicy", () => {
  it("denies a disabled destination regardless of its flags", () => {
    const decision = evaluatePublishingPolicy(buildDestination({ enabled: false, autoPublish: false }), PublishableContentType.TICKET);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/disabled/i);
  });

  it("denies a destination without auto-publish enabled", () => {
    const decision = evaluatePublishingPolicy(buildDestination({ autoPublish: false }), PublishableContentType.TICKET);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/auto-publish/i);
  });

  it("allows a content type the destination explicitly accepts", () => {
    const decision = evaluatePublishingPolicy(buildDestination(), PublishableContentType.TICKET);
    expect(decision.allowed).toBe(true);
  });

  it("denies a content type the destination has not opted into", () => {
    const decision = evaluatePublishingPolicy(buildDestination(), PublishableContentType.RESULTS);
    expect(decision.allowed).toBe(false);
  });
});

describe("selectPublishableDestinations", () => {
  it("filters a destination list down to only the ones allowed for this content type", () => {
    const destinations = [
      buildDestination({ destinationId: "d1", publishTicket: true }),
      buildDestination({ destinationId: "d2", publishTicket: false }),
      buildDestination({ destinationId: "d3", enabled: false, autoPublish: false, publishTicket: true }),
    ];
    const selected = selectPublishableDestinations(destinations, PublishableContentType.TICKET);
    expect(selected.map((d) => d.destinationId)).toEqual(["d1"]);
  });
});
