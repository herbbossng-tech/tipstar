import { err, IntegrationError, NotImplementedError, ok, type Result } from "@sport-os/shared";
import type { TelegramDestination } from "./types.js";

export interface SendMessageResult {
  readonly messageId: number;
}

/**
 * TelegramService — Bot API communication boundary (Section 01 — Backend/
 * Service Boundaries). Message CONTENT and WHEN to send it are decided by
 * callers (agents, the Publishing Policy Engine) — this service only
 * knows how to talk to the Telegram Bot API.
 */
export interface TelegramService {
  sendMessage(chatId: string, text: string): Promise<Result<SendMessageResult, IntegrationError>>;
  replyToMessage(chatId: string, replyToMessageId: number, text: string): Promise<Result<SendMessageResult, IntegrationError>>;
}

export interface TelegramBotApiServiceOptions {
  readonly botToken: string;
  /** Injectable for testing — defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
}

/** Thin, real Telegram Bot API client. No message content/policy decisions live here. */
export class TelegramBotApiService implements TelegramService {
  private readonly botToken: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TelegramBotApiServiceOptions) {
    this.botToken = options.botToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async sendMessage(chatId: string, text: string): Promise<Result<SendMessageResult, IntegrationError>> {
    return this.call("sendMessage", { chat_id: chatId, text });
  }

  async replyToMessage(chatId: string, replyToMessageId: number, text: string): Promise<Result<SendMessageResult, IntegrationError>> {
    return this.call("sendMessage", { chat_id: chatId, text, reply_to_message_id: replyToMessageId });
  }

  private async call(method: string, body: Record<string, unknown>): Promise<Result<SendMessageResult, IntegrationError>> {
    try {
      const response = await this.fetchImpl(`https://api.telegram.org/bot${this.botToken}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { ok: boolean; result?: { message_id: number }; description?: string };
      if (!response.ok || !payload.ok || !payload.result) {
        return err(new IntegrationError({ message: "Telegram Bot API request failed.", context: { method, description: payload.description } }));
      }
      return ok({ messageId: payload.result.message_id });
    } catch (cause) {
      return err(new IntegrationError({ message: "Telegram Bot API is unreachable.", cause }));
    }
  }
}

/**
 * PublishingService — the 14th backend boundary that actually dispatches
 * publishable content to destinations. Deferred: it depends on a
 * persisted destination catalog (Telegram Destination Manager), which is
 * a Section 03 (database) concern.
 */
export interface PublishingService {
  publish(destinationId: string, content: string): Promise<Result<SendMessageResult, IntegrationError>>;
}

export class NotImplementedPublishingService implements PublishingService {
  async publish(_destinationId: string, _content: string): Promise<Result<SendMessageResult, IntegrationError>> {
    throw new NotImplementedError("PublishingService.publish");
  }
}

/**
 * Telegram Destination Manager (Section 01 — PLATFORM). Persisted
 * destination CRUD is deferred to Section 03 (database) — this contract
 * fixes the shape so callers can already be written against it.
 */
export interface TelegramDestinationManager {
  list(): Promise<readonly TelegramDestination[]>;
  get(destinationId: string): Promise<TelegramDestination | undefined>;
  create(destination: Omit<TelegramDestination, "destinationId" | "createdAt">): Promise<TelegramDestination>;
  update(destinationId: string, patch: Partial<Omit<TelegramDestination, "destinationId" | "createdAt">>): Promise<TelegramDestination>;
}

export class NotImplementedTelegramDestinationManager implements TelegramDestinationManager {
  async list(): Promise<readonly TelegramDestination[]> {
    throw new NotImplementedError("TelegramDestinationManager.list");
  }
  async get(_destinationId: string): Promise<TelegramDestination | undefined> {
    throw new NotImplementedError("TelegramDestinationManager.get");
  }
  async create(_destination: Omit<TelegramDestination, "destinationId" | "createdAt">): Promise<TelegramDestination> {
    throw new NotImplementedError("TelegramDestinationManager.create");
  }
  async update(_destinationId: string, _patch: Partial<Omit<TelegramDestination, "destinationId" | "createdAt">>): Promise<TelegramDestination> {
    throw new NotImplementedError("TelegramDestinationManager.update");
  }
}
