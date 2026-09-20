const SENSITIVE_KEY_PATTERN = /token|secret|password|api[_-]?key|service[_-]?role|authorization|hash|credential/i;
const REDACTED = "[REDACTED]";

/**
 * Recursively redacts values whose key looks sensitive before logging.
 * Called by every Logger implementation in this package — never log a raw
 * context object without passing it through this first (Engineering
 * Constitution: "Never log secrets", "Never log sensitive authentication
 * credentials").
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
