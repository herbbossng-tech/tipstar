import { buildIdempotencyKey } from "@tipstar/shared";
import type { NotificationMessage, NotificationProvider } from "./provider.js";

/** Tracks which idempotency keys have already been dispatched, so retried sends never duplicate a message. */
export interface DispatchedNotificationStore {
  hasBeenSent(idempotencyKey: string): Promise<boolean>;
  markSent(idempotencyKey: string): Promise<void>;
}

/**
 * DEVELOPMENT/TEST-ONLY in-memory store for NotificationDispatcher.
 * A production implementation is backed by a unique constraint in Postgres.
 */
export class InMemoryDispatchedNotificationStore implements DispatchedNotificationStore {
  private readonly sent = new Set<string>();
  async hasBeenSent(idempotencyKey: string): Promise<boolean> {
    return this.sent.has(idempotencyKey);
  }
  async markSent(idempotencyKey: string): Promise<void> {
    this.sent.add(idempotencyKey);
  }
}

/**
 * Dispatches a notification exactly once per idempotency key (Section 24).
 * `dedupeKey` should identify the business event (e.g. `pick:{pickId}:published`)
 * so retried webhook/cron triggers never spam the same alert twice.
 */
export class NotificationDispatcher {
  constructor(
    private readonly provider: NotificationProvider,
    private readonly store: DispatchedNotificationStore,
  ) {}

  async dispatch(message: NotificationMessage, dedupeKey: string): Promise<"sent" | "skipped_duplicate"> {
    const idempotencyKey = buildIdempotencyKey("notification", dedupeKey);
    if (await this.store.hasBeenSent(idempotencyKey)) {
      return "skipped_duplicate";
    }
    await this.provider.send(message);
    await this.store.markSent(idempotencyKey);
    return "sent";
  }
}
