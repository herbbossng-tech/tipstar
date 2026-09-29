import { err, ok } from "@sport-os/shared";
import { PublishableContentType, TelegramDestinationType, type SendMessageResult, type TelegramDestination, type TelegramDestinationManager, type TelegramService } from "@sport-os/telegram";
import { IntegrationError } from "@sport-os/shared";
import { describe, expect, it } from "vitest";
import { TelegramChannelManagementAgent } from "./telegram-channel-agent.js";

function destination(overrides: Partial<TelegramDestination> = {}): TelegramDestination {
  return {
    destinationId: "d1",
    telegramChatId: "-1001",
    name: "Main Channel",
    type: TelegramDestinationType.CHANNEL,
    enabled: true,
    autoPublish: true,
    publishBookingCode: false,
    publishTicket: true,
    publishResults: false,
    publishWeeklyReport: false,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

class StubDestinationManager implements TelegramDestinationManager {
  constructor(private readonly destinations: readonly TelegramDestination[]) {}
  async list() {
    return this.destinations;
  }
  async get(destinationId: string) {
    return this.destinations.find((d) => d.destinationId === destinationId);
  }
  async create(): Promise<TelegramDestination> {
    throw new Error("not used in this test");
  }
  async update(): Promise<TelegramDestination> {
    throw new Error("not used in this test");
  }
}

class RecordingTelegramService implements TelegramService {
  sentTo: string[] = [];
  sentTexts: string[] = [];
  async sendMessage(chatId: string, text: string) {
    this.sentTo.push(chatId);
    this.sentTexts.push(text);
    return ok<SendMessageResult>({ messageId: 42 });
  }
  async replyToMessage() {
    return err(new IntegrationError({ message: "not used" }));
  }
}

describe("TelegramChannelManagementAgent", () => {
  it("publishes only to destinations the Publishing Policy Engine allows for this content type", async () => {
    const destinations = new StubDestinationManager([destination({ destinationId: "allowed", publishTicket: true }), destination({ destinationId: "blocked", publishTicket: false })]);
    const telegram = new RecordingTelegramService();
    const agent = new TelegramChannelManagementAgent({ destinations, telegram });
    agent.markReady();
    const response = await agent.execute({
      requestId: "req-1",
      input: { contentReferenceId: "ticket-1", contentType: PublishableContentType.TICKET, finalizedText: "Ticket #1: HOME @ 2.00" },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    expect(response.output.published).toHaveLength(1);
    expect(response.output.published[0]?.destinationId).toBe("allowed");
    expect(response.output.skipped).toHaveLength(1);
    expect(response.output.skipped[0]?.destinationId).toBe("blocked");
  });

  it("sends the finalizedText byte-for-byte — never alters selections/odds/content (§11)", async () => {
    const text = "Ticket #1: HOME @ 2.00, AWAY @ 1.80";
    const destinations = new StubDestinationManager([destination()]);
    const telegram = new RecordingTelegramService();
    const agent = new TelegramChannelManagementAgent({ destinations, telegram });
    agent.markReady();
    await agent.execute({ requestId: "req-1", input: { contentReferenceId: "ticket-1", contentType: PublishableContentType.TICKET, finalizedText: text }, audit: { requestId: "req-1", actor: "user-1" } });
    expect(telegram.sentTexts[0]).toBe(text);
  });

  it("tracks the returned Telegram message id, associating destination -> message", async () => {
    const destinations = new StubDestinationManager([destination()]);
    const telegram = new RecordingTelegramService();
    const agent = new TelegramChannelManagementAgent({ destinations, telegram });
    agent.markReady();
    const response = await agent.execute({ requestId: "req-1", input: { contentReferenceId: "ticket-1", contentType: PublishableContentType.TICKET, finalizedText: "x" }, audit: { requestId: "req-1", actor: "user-1" } });
    expect(response.output.published[0]?.telegramMessageId).toBe(42);
  });

  it("a disabled destination is never published to, even if it would otherwise accept the content type", async () => {
    const destinations = new StubDestinationManager([destination({ enabled: false })]);
    const telegram = new RecordingTelegramService();
    const agent = new TelegramChannelManagementAgent({ destinations, telegram });
    agent.markReady();
    const response = await agent.execute({ requestId: "req-1", input: { contentReferenceId: "ticket-1", contentType: PublishableContentType.TICKET, finalizedText: "x" }, audit: { requestId: "req-1", actor: "user-1" } });
    expect(response.output.published).toHaveLength(0);
    expect(telegram.sentTo).toHaveLength(0);
  });
});
