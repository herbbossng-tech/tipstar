/**
 * Generates a UUIDv4. Uses the standard Web Crypto API (`crypto.randomUUID`)
 * rather than `node:crypto` so this package stays safely importable from
 * both server code and the Mini App's browser bundle — Node >= 19 and
 * every modern browser both expose `globalThis.crypto.randomUUID()`
 * natively. Centralized so the ID generation strategy can change in one
 * place.
 */
export function generateId(): string {
  return globalThis.crypto.randomUUID();
}

/** Generates a request/event correlation ID for logging and audit trails. */
export function generateCorrelationId(): string {
  return globalThis.crypto.randomUUID();
}
