import { err, IntegrationError, NotImplementedError, ok, type ISODateString, type Result, type UUID } from "@sport-os/shared";
import { categorizeTelegramApiError, extractRetryAfterSeconds, isRetryableTelegramError } from "./telegram-errors.js";
import { TelegramApiErrorCategory, type PublicationSourceType, type PublishableContentType, type TelegramDestination, type TelegramPublicationStatus } from "./types.js";

export interface SendMessageResult {
  readonly messageId: number;
}

export interface GetChatResult {
  readonly id: number;
  readonly type: "private" | "group" | "supergroup" | "channel";
  readonly title: string | undefined;
}

export interface GetChatMemberResult {
  readonly status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked";
}

/** A single `InlineKeyboardButton` row entry — URL-only (§37/§39: no callback buttons are implemented in this build, so there is no callback-query handling to secure; see TELEGRAM_SECURITY.md's "Callback buttons were not built"). */
export interface InlineKeyboardUrlButton {
  readonly text: string;
  readonly url: string;
}

export interface SendMessageOptions {
  /** Each inner array is one row of buttons — mirrors Telegram's own `inline_keyboard` shape exactly, never reinvented. */
  readonly inlineKeyboard?: readonly (readonly InlineKeyboardUrlButton[])[];
  readonly parseMode?: "HTML";
}

/**
 * TelegramService — Bot API communication boundary (Section 01 — Backend/
 * Service Boundaries; retry/timeout/rate-limit/error-categorization and
 * getChat/getChatMember added Section 10 §60/§61). Message CONTENT and
 * WHEN to send it are decided by callers (agents, the Publishing Policy
 * Engine) — this service only knows how to talk to the Telegram Bot API.
 */
export interface TelegramService {
  sendMessage(chatId: string, text: string, options?: SendMessageOptions): Promise<Result<SendMessageResult, IntegrationError>>;
  replyToMessage(chatId: string, replyToMessageId: number, text: string, options?: SendMessageOptions): Promise<Result<SendMessageResult, IntegrationError>>;
  /** Used only for destination verification (§10) — never for publishing decisions. */
  getChat(chatId: string): Promise<Result<GetChatResult, IntegrationError>>;
  /** Used only for destination verification (§10/§11) — confirms the BOT's own membership/admin status in a chat, never a regular user's. */
  getChatMember(chatId: string, telegramUserId: number): Promise<Result<GetChatMemberResult, IntegrationError>>;
}

export interface TelegramBotApiServiceOptions {
  readonly botToken: string;
  /** Injectable for testing — defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
  /** Bounded retry count for TRANSIENT/RATE_LIMITED failures only (§27/§28) — default 2 (3 attempts total). Never unbounded. */
  readonly retryLimit?: number;
  /** Per-attempt timeout (§60) — default 10s. */
  readonly timeoutMs?: number;
  /** Injectable sleep for deterministic retry/backoff tests — defaults to a real `setTimeout`-based delay. */
  readonly sleepImpl?: (ms: number) => Promise<void>;
}

const DEFAULT_RETRY_LIMIT = 2;
const DEFAULT_TIMEOUT_MS = 10_000;
const BASE_BACKOFF_MS = 100;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Thin, real Telegram Bot API client. No message content/policy decisions live here — only HOW to talk to the Bot API, bounded retry of transient failures, and honest error categorization. */
export class TelegramBotApiService implements TelegramService {
  private readonly botToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly retryLimit: number;
  private readonly timeoutMs: number;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(options: TelegramBotApiServiceOptions) {
    this.botToken = options.botToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.retryLimit = options.retryLimit ?? DEFAULT_RETRY_LIMIT;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.sleepImpl = options.sleepImpl ?? defaultSleep;
  }

  async sendMessage(chatId: string, text: string, options?: SendMessageOptions): Promise<Result<SendMessageResult, IntegrationError>> {
    const result = await this.call<{ message_id: number }>("sendMessage", { chat_id: chatId, text, ...this.renderOptions(options) });
    return mapSendResult(result);
  }

  async replyToMessage(chatId: string, replyToMessageId: number, text: string, options?: SendMessageOptions): Promise<Result<SendMessageResult, IntegrationError>> {
    const result = await this.call<{ message_id: number }>("sendMessage", { chat_id: chatId, text, reply_to_message_id: replyToMessageId, ...this.renderOptions(options) });
    return mapSendResult(result);
  }

  async getChat(chatId: string): Promise<Result<GetChatResult, IntegrationError>> {
    const result = await this.call<{ id: number; type: GetChatResult["type"]; title?: string }>("getChat", { chat_id: chatId });
    if (!result.ok) return err(result.error);
    return ok({ id: result.value.id, type: result.value.type, title: result.value.title });
  }

  async getChatMember(chatId: string, telegramUserId: number): Promise<Result<GetChatMemberResult, IntegrationError>> {
    const result = await this.call<{ status: GetChatMemberResult["status"] }>("getChatMember", { chat_id: chatId, user_id: telegramUserId });
    if (!result.ok) return err(result.error);
    return ok({ status: result.value.status });
  }

  private renderOptions(options: SendMessageOptions | undefined): Record<string, unknown> {
    if (!options) return {};
    const body: Record<string, unknown> = {};
    if (options.parseMode) body.parse_mode = options.parseMode;
    if (options.inlineKeyboard) {
      body.reply_markup = { inline_keyboard: options.inlineKeyboard.map((row) => row.map((button) => ({ text: button.text, url: button.url }))) };
    }
    return body;
  }

  /** Bounded retry (§27/§28): only TRANSIENT/RATE_LIMITED failures are retried, up to `retryLimit` additional attempts, honoring Telegram's own `retry_after` on a 429 and otherwise backing off exponentially. Every other category fails immediately on the first attempt. */
  private async call<T>(method: string, body: Record<string, unknown>): Promise<Result<T, IntegrationError>> {
    let lastCategory: TelegramApiErrorCategory = TelegramApiErrorCategory.UNKNOWN;
    let lastMessage = "Telegram Bot API request failed.";
    let lastDescription: string | undefined;

    for (let attempt = 0; attempt <= this.retryLimit; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(`https://api.telegram.org/bot${this.botToken}/${method}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const payload = (await response.json()) as { ok: boolean; result?: T; description?: string; error_code?: number; parameters?: { retry_after?: number } };

        if (payload.ok && payload.result !== undefined) {
          return ok(payload.result);
        }

        const category = categorizeTelegramApiError({ httpStatus: response.status, errorCode: payload.error_code, description: payload.description });
        lastCategory = category;
        lastDescription = payload.description;
        lastMessage = `Telegram Bot API request failed: ${method}.`;

        if (!isRetryableTelegramError(category) || attempt === this.retryLimit) {
          break;
        }

        const retryAfterSeconds = extractRetryAfterSeconds(payload.parameters);
        const delayMs = retryAfterSeconds !== undefined ? retryAfterSeconds * 1000 : BASE_BACKOFF_MS * 2 ** attempt;
        await this.sleepImpl(delayMs);
      } catch (cause) {
        lastCategory = TelegramApiErrorCategory.TRANSIENT;
        lastMessage = "Telegram Bot API is unreachable.";
        lastDescription = cause instanceof Error ? cause.message : String(cause);
        if (attempt === this.retryLimit) break;
        await this.sleepImpl(BASE_BACKOFF_MS * 2 ** attempt);
      } finally {
        clearTimeout(timeout);
      }
    }

    return err(new IntegrationError({ message: lastMessage, code: lastCategory, context: { method, description: lastDescription } }));
  }
}

function mapSendResult(result: Result<{ message_id: number }, IntegrationError>): Result<SendMessageResult, IntegrationError> {
  if (!result.ok) return err(result.error);
  return ok({ messageId: result.value.message_id });
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
 * fixes the shape so callers can already be written against it. The
 * real, Supabase-backed implementation (`SupabaseTelegramDestinationManager`)
 * lives in `@sport-os/agents` as of Section 10 — see
 * docs/architecture/TELEGRAM_DESTINATIONS.md (this package stays
 * dependency-free of `@sport-os/platform`/Supabase, matching
 * `@sport-os/platform`'s own existing dependency on `@sport-os/telegram`).
 */
export interface TelegramDestinationManager {
  list(): Promise<readonly TelegramDestination[]>;
  get(destinationId: string): Promise<TelegramDestination | undefined>;
  /** `createdBy` (Section 10 addition — an opaque user id) names who added this destination, for audit/traceability; it is never interpreted by this interface itself. */
  create(destination: Omit<TelegramDestination, "destinationId" | "createdAt">, createdBy: string): Promise<TelegramDestination>;
  update(destinationId: string, patch: Partial<Omit<TelegramDestination, "destinationId" | "createdAt">>): Promise<TelegramDestination>;
}

export class NotImplementedTelegramDestinationManager implements TelegramDestinationManager {
  async list(): Promise<readonly TelegramDestination[]> {
    throw new NotImplementedError("TelegramDestinationManager.list");
  }
  async get(_destinationId: string): Promise<TelegramDestination | undefined> {
    throw new NotImplementedError("TelegramDestinationManager.get");
  }
  async create(_destination: Omit<TelegramDestination, "destinationId" | "createdAt">, _createdBy: string): Promise<TelegramDestination> {
    throw new NotImplementedError("TelegramDestinationManager.create");
  }
  async update(_destinationId: string, _patch: Partial<Omit<TelegramDestination, "destinationId" | "createdAt">>): Promise<TelegramDestination> {
    throw new NotImplementedError("TelegramDestinationManager.update");
  }
}

/**
 * Durable publication record (Section 10 §21/§30/§49) — mirrors
 * `PublicationRequest` plus the outcome fields a request doesn't carry
 * (`status`/`telegramMessageId`/`attemptCount`/`lastError`). The real,
 * Supabase-backed implementation (`TelegramPublicationsRepository` in
 * `@sport-os/agents`) lives alongside `SupabaseTelegramDestinationManager`
 * for the same dependency-direction reason.
 */
export interface TelegramPublicationRecord {
  readonly id: UUID;
  readonly sourceType: PublicationSourceType;
  readonly sourceId: string;
  readonly sourceVersion: number;
  readonly publicationType: PublishableContentType;
  readonly destinationId: UUID;
  readonly status: TelegramPublicationStatus;
  readonly telegramMessageId: number | undefined;
  readonly replyToTelegramMessageId: number | undefined;
  readonly templateVersion: string;
  readonly policyVersion: string;
  readonly requestedBy: string;
  readonly idempotencyKey: string;
  readonly correlationId: UUID;
  readonly attemptCount: number;
  readonly lastError: string | undefined;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
}

export interface NewTelegramPublicationInput {
  readonly sourceType: PublicationSourceType;
  readonly sourceId: string;
  readonly sourceVersion: number;
  readonly publicationType: PublishableContentType;
  readonly destinationId: UUID;
  readonly templateVersion: string;
  readonly policyVersion: string;
  readonly requestedBy: string;
  readonly idempotencyKey: string;
  readonly correlationId: UUID;
  readonly replyToTelegramMessageId?: number;
}

export interface TelegramPublicationCompletionInput {
  readonly status: TelegramPublicationStatus;
  readonly telegramMessageId?: number;
  readonly lastError?: string;
}

/**
 * `findOrCreate` is the idempotency entry point (§49): a repeat call for
 * the exact same (sourceType, sourceId, sourceVersion, publicationType,
 * destinationId) tuple always returns the SAME row, never a second one
 * — a retry must not create a duplicate Telegram message.
 */
export interface TelegramPublicationsRepository {
  findOrCreate(input: NewTelegramPublicationInput): Promise<TelegramPublicationRecord>;
  transitionTo(id: UUID, completion: TelegramPublicationCompletionInput): Promise<TelegramPublicationRecord>;
  /** The most recent PUBLISHED ticket/pick publication at this destination for this source — the message a RESULTS publication should reply to (§22). `undefined` means "no eligible original message," never guessed/fabricated. */
  findOriginalMessageForReply(params: { readonly sourceType: PublicationSourceType; readonly sourceId: string; readonly destinationId: UUID }): Promise<TelegramPublicationRecord | undefined>;
  /** How many PUBLISHED publications of this type this destination already has since `since` — the real, counted figure `PublicationPolicyContext.publicationsToday` requires; this engine never estimates it. */
  countPublishedSince(destinationId: UUID, publicationType: PublishableContentType, since: ISODateString): Promise<number>;
}

export class NotImplementedTelegramPublicationsRepository implements TelegramPublicationsRepository {
  async findOrCreate(_input: NewTelegramPublicationInput): Promise<TelegramPublicationRecord> {
    throw new NotImplementedError("TelegramPublicationsRepository.findOrCreate");
  }
  async transitionTo(_id: UUID, _completion: TelegramPublicationCompletionInput): Promise<TelegramPublicationRecord> {
    throw new NotImplementedError("TelegramPublicationsRepository.transitionTo");
  }
  async findOriginalMessageForReply(): Promise<TelegramPublicationRecord | undefined> {
    throw new NotImplementedError("TelegramPublicationsRepository.findOriginalMessageForReply");
  }
  async countPublishedSince(): Promise<number> {
    throw new NotImplementedError("TelegramPublicationsRepository.countPublishedSince");
  }
}
