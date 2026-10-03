import { err, IntegrationError, ok } from "@sport-os/shared";
import {
  PublicationSourceType,
  PublishableContentType,
  TelegramDestinationType,
  TelegramPublicationStatus,
  type NewTelegramPublicationInput,
  type SendMessageResult,
  type TelegramDestination,
  type TelegramDestinationManager,
  type TelegramPublicationCompletionInput,
  type TelegramPublicationRecord,
  type TelegramPublicationsRepository,
  type TelegramService,
} from "@sport-os/telegram";
import { describe, expect, it } from "vitest";
import { TelegramChannelManagementAgent } from "./telegram-channel-agent.js";

/**
 * In-memory stand-in for the real, database-enforced idempotency
 * boundary (`telegram_publications_natural_key_idx`) — `findOrCreate()`
 * here replicates the real repository's own "upsert, ignore duplicate,
 * always re-select the winning row" contract, just against a `Map`
 * instead of Postgres.
 */
class FakePublicationsRepository implements TelegramPublicationsRepository {
  private readonly rows = new Map<string, TelegramPublicationRecord>();
  private nextId = 1;

  private key(sourceType: string, sourceId: string, sourceVersion: number, publicationType: string, destinationId: string): string {
    return `${sourceType}:${sourceId}:${sourceVersion}:${publicationType}:${destinationId}`;
  }

  async findOrCreate(input: NewTelegramPublicationInput): Promise<TelegramPublicationRecord> {
    const key = this.key(input.sourceType, input.sourceId, input.sourceVersion, input.publicationType, input.destinationId);
    const existing = this.rows.get(key);
    if (existing) return existing;
    const now = new Date().toISOString();
    const row: TelegramPublicationRecord = {
      id: `pub-${this.nextId++}`,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceVersion: input.sourceVersion,
      publicationType: input.publicationType,
      destinationId: input.destinationId,
      status: TelegramPublicationStatus.PENDING,
      telegramMessageId: undefined,
      replyToTelegramMessageId: input.replyToTelegramMessageId,
      templateVersion: input.templateVersion,
      policyVersion: input.policyVersion,
      requestedBy: input.requestedBy,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
      attemptCount: 0,
      lastError: undefined,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(key, row);
    return row;
  }

  async transitionTo(id: string, completion: TelegramPublicationCompletionInput): Promise<TelegramPublicationRecord> {
    for (const [key, row] of this.rows) {
      if (row.id === id) {
        const updated: TelegramPublicationRecord = { ...row, status: completion.status, telegramMessageId: completion.telegramMessageId ?? row.telegramMessageId, lastError: completion.lastError, attemptCount: row.attemptCount + 1, updatedAt: new Date().toISOString() };
        this.rows.set(key, updated);
        return updated;
      }
    }
    throw new Error(`No publication found with id "${id}".`);
  }

  async findOriginalMessageForReply(params: { readonly sourceType: string; readonly sourceId: string; readonly destinationId: string }): Promise<TelegramPublicationRecord | undefined> {
    return [...this.rows.values()]
      .filter((row) => row.sourceType === params.sourceType && row.sourceId === params.sourceId && row.destinationId === params.destinationId && (row.publicationType === "ticket" || row.publicationType === "pick") && row.status === TelegramPublicationStatus.PUBLISHED)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }

  async countPublishedSince(): Promise<number> {
    return 0;
  }

  size(): number {
    return this.rows.size;
  }
}

function destination(overrides: Partial<TelegramDestination> = {}): TelegramDestination {
  return {
    destinationId: "d1",
    telegramChatId: "-1001",
    name: "Main",
    type: TelegramDestinationType.CHANNEL,
    enabled: true,
    autoPublish: true,
    publishBookingCode: false,
    publishTicket: true,
    publishResults: true,
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
    throw new Error("not used");
  }
  async update(): Promise<TelegramDestination> {
    throw new Error("not used");
  }
}

describe("TelegramChannelManagementAgent — Section 10 persistence/idempotency/fanout/reply", () => {
  it("TEST A: a retried execute() for the same ticket+destination never sends a second Telegram message (durable idempotency, §49)", async () => {
    let sendCalls = 0;
    const telegram: TelegramService = {
      sendMessage: async () => {
        sendCalls += 1;
        return ok<SendMessageResult>({ messageId: 99 });
      },
      replyToMessage: async () => ok<SendMessageResult>({ messageId: 99 }),
      getChat: async () => err(new IntegrationError({ message: "not used" })),
      getChatMember: async () => err(new IntegrationError({ message: "not used" })),
    };
    const publications = new FakePublicationsRepository();
    const agent = new TelegramChannelManagementAgent({ destinations: new StubDestinationManager([destination()]), telegram, publications });
    agent.markReady();
    const input = { contentReferenceId: "ticket-1", contentType: PublishableContentType.TICKET, finalizedText: "HOME @ 2.00" };
    const first = await agent.execute({ requestId: "r1", input, audit: { requestId: "r1", actor: "user-1" } });
    const second = await agent.execute({ requestId: "r2", input, audit: { requestId: "r2", actor: "user-1" } });
    expect(sendCalls).toBe(1);
    expect(first.output.published[0]?.telegramMessageId).toBe(99);
    expect(second.output.published[0]?.telegramMessageId).toBe(99);
  });

  it("TEST B: multi-channel fanout — one destination's send failure never marks another destination as failed", async () => {
    const telegram: TelegramService = {
      sendMessage: async (chatId) => {
        if (chatId === "-2002") return err(new IntegrationError({ message: "bot was kicked", code: "BOT_PERMISSION" }));
        return ok<SendMessageResult>({ messageId: 1 });
      },
      replyToMessage: async () => ok<SendMessageResult>({ messageId: 1 }),
      getChat: async () => err(new IntegrationError({ message: "not used" })),
      getChatMember: async () => err(new IntegrationError({ message: "not used" })),
    };
    const destinations = new StubDestinationManager([destination({ destinationId: "A", telegramChatId: "-1001" }), destination({ destinationId: "B", telegramChatId: "-2002" }), destination({ destinationId: "C", telegramChatId: "-3003" })]);
    const agent = new TelegramChannelManagementAgent({ destinations, telegram, publications: new FakePublicationsRepository() });
    agent.markReady();
    const response = await agent.execute({
      requestId: "r1",
      input: { contentReferenceId: "ticket-2", contentType: PublishableContentType.TICKET, finalizedText: "x" },
      audit: { requestId: "r1", actor: "user-1" },
    });
    expect(response.output.published.map((p) => p.destinationId).sort()).toEqual(["A", "C"]);
    expect(response.output.skipped.map((s) => s.destinationId)).toEqual(["B"]);
  });

  it("TEST C: a RESULTS publication replies to the original ticket message when one is on record (§22)", async () => {
    let capturedReplyTo: number | undefined;
    const telegram: TelegramService = {
      sendMessage: async () => ok<SendMessageResult>({ messageId: 500 }),
      replyToMessage: async (_chatId, replyToMessageId) => {
        capturedReplyTo = replyToMessageId;
        return ok<SendMessageResult>({ messageId: 600 });
      },
      getChat: async () => err(new IntegrationError({ message: "not used" })),
      getChatMember: async () => err(new IntegrationError({ message: "not used" })),
    };
    const publications = new FakePublicationsRepository();
    const agent = new TelegramChannelManagementAgent({ destinations: new StubDestinationManager([destination()]), telegram, publications });
    agent.markReady();

    await agent.execute({
      requestId: "r1",
      input: { contentReferenceId: "ticket-3", contentType: PublishableContentType.TICKET, finalizedText: "HOME @ 2.00", sourceType: PublicationSourceType.TICKET },
      audit: { requestId: "r1", actor: "user-1" },
    });
    const resultsResponse = await agent.execute({
      requestId: "r2",
      input: { contentReferenceId: "ticket-3", contentType: PublishableContentType.RESULTS, finalizedText: "WON", sourceType: PublicationSourceType.TICKET },
      audit: { requestId: "r2", actor: "user-1" },
    });

    expect(capturedReplyTo).toBe(500);
    expect(resultsResponse.output.published[0]?.telegramMessageId).toBe(600);
  });

  it("TEST D: a RESULTS publication falls back to a plain send (never a fabricated reply target) when no original message is on record", async () => {
    let replyCalled = false;
    const telegram: TelegramService = {
      sendMessage: async () => ok<SendMessageResult>({ messageId: 700 }),
      replyToMessage: async () => {
        replyCalled = true;
        return ok<SendMessageResult>({ messageId: 700 });
      },
      getChat: async () => err(new IntegrationError({ message: "not used" })),
      getChatMember: async () => err(new IntegrationError({ message: "not used" })),
    };
    const agent = new TelegramChannelManagementAgent({ destinations: new StubDestinationManager([destination()]), telegram, publications: new FakePublicationsRepository() });
    agent.markReady();
    const response = await agent.execute({
      requestId: "r1",
      input: { contentReferenceId: "ticket-4", contentType: PublishableContentType.RESULTS, finalizedText: "WON", sourceType: PublicationSourceType.TICKET },
      audit: { requestId: "r1", actor: "user-1" },
    });
    expect(replyCalled).toBe(false);
    expect(response.output.published[0]?.telegramMessageId).toBe(700);
  });

  it("TEST E: a permanently failed send records FAILED, not a fabricated success — and never retries silently without a publications repository bump", async () => {
    const telegram: TelegramService = {
      sendMessage: async () => err(new IntegrationError({ message: "chat not found", code: "NOT_FOUND" })),
      replyToMessage: async () => err(new IntegrationError({ message: "not used" })),
      getChat: async () => err(new IntegrationError({ message: "not used" })),
      getChatMember: async () => err(new IntegrationError({ message: "not used" })),
    };
    const publications = new FakePublicationsRepository();
    const agent = new TelegramChannelManagementAgent({ destinations: new StubDestinationManager([destination()]), telegram, publications });
    agent.markReady();
    const response = await agent.execute({
      requestId: "r1",
      input: { contentReferenceId: "ticket-5", contentType: PublishableContentType.TICKET, finalizedText: "x" },
      audit: { requestId: "r1", actor: "user-1" },
    });
    expect(response.output.published).toHaveLength(0);
    expect(response.output.skipped[0]?.reason).toContain("chat not found");
  });
});
