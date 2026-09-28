import { timingSafeEqual } from "node:crypto";

/**
 * Verifies the `X-Telegram-Bot-Api-Secret-Token` header Telegram sends on
 * every webhook request, against the secret registered via setWebhook.
 * Reject any webhook request that fails this check before processing it.
 */
export function verifyWebhookSecret(headerValue: string | undefined | null, expectedSecret: string): boolean {
  if (!headerValue) return false;
  const a = Buffer.from(headerValue);
  const b = Buffer.from(expectedSecret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
