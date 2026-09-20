import { randomUUID } from "node:crypto";

/** Generates a UUIDv4. Centralized so ID generation strategy can change in one place. */
export function generateId(): string {
  return randomUUID();
}

/**
 * Builds a deterministic idempotency key by joining namespaced parts.
 * Used for idempotent operations (see Engineering Constitution section 24):
 * Telegram user creation, webhook processing, pick publication, settlement,
 * subscription webhooks, notification dispatch, affiliate attribution.
 */
export function buildIdempotencyKey(namespace: string, ...parts: readonly (string | number)[]): string {
  return [namespace, ...parts.map(String)].join(":");
}
