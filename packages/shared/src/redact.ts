const SENSITIVE_KEY_PATTERN = /token|secret|password|api[_-]?key|service[_-]?role|authorization|credential|private[_-]?key/i;
const REDACTED = "[REDACTED]";

/**
 * Recursively redacts values whose key looks sensitive before logging.
 * Every Logger implementation in this package calls this — never log a raw
 * context/metadata object without passing it through this first (Section
 * 01 Logging: never log API secrets, bot tokens, passwords, credentials,
 * private keys, or full sensitive payloads).
 */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(val);
    }
    return result;
  }
  return value;
}
