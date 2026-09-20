import type { TipstarErrorShape } from "./result.js";

/**
 * Structured error used throughout Tipstar (see Engineering Constitution,
 * section 27: errors carry an internal code, a safe user-facing message,
 * diagnostic context, a timestamp, and an optional correlation id).
 *
 * `message` must always be safe to show to an end user. Put anything
 * sensitive or diagnostic-only into `context`, and never let it contain
 * secrets/credentials — see redact() in @tipstar/audit before logging.
 */
export class TipstarError extends Error implements TipstarErrorShape {
  readonly code: string;
  readonly context: Readonly<Record<string, unknown>>;
  readonly timestamp: string;
  readonly correlationId: string | undefined;

  constructor(params: {
    code: string;
    message: string;
    context?: Record<string, unknown>;
    correlationId?: string;
    cause?: unknown;
  }) {
    super(params.message, params.cause !== undefined ? { cause: params.cause } : undefined);
    this.name = "TipstarError";
    this.code = params.code;
    this.context = Object.freeze({ ...(params.context ?? {}) });
    this.timestamp = new Date().toISOString();
    this.correlationId = params.correlationId;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      timestamp: this.timestamp,
      correlationId: this.correlationId,
    };
  }
}

export const ErrorCodes = {
  VALIDATION_FAILED: "VALIDATION_FAILED",
  NOT_FOUND: "NOT_FOUND",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  CONFLICT: "CONFLICT",
  ALREADY_SETTLED: "ALREADY_SETTLED",
  IMMUTABLE_RECORD: "IMMUTABLE_RECORD",
  INSUFFICIENT_EVIDENCE: "INSUFFICIENT_EVIDENCE",
  PROVIDER_ERROR: "PROVIDER_ERROR",
  TELEGRAM_AUTH_INVALID: "TELEGRAM_AUTH_INVALID",
  TELEGRAM_AUTH_EXPIRED: "TELEGRAM_AUTH_EXPIRED",
  CONFIG_INVALID: "CONFIG_INVALID",
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
