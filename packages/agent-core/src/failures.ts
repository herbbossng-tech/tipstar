import { AppError, ErrorKind } from "@sport-os/shared";

/**
 * The closed set of agent-invocation failure codes (Section 06 §22).
 * "Do not convert failures into successful-looking outputs" — every
 * agent invocation that does not produce a valid output must resolve to
 * exactly one of these, never a bare string or an untyped throw that
 * escapes the orchestrator.
 */
export const AgentFailureCode = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  AUTHORIZATION_ERROR: "AUTHORIZATION_ERROR",
  ENTITLEMENT_ERROR: "ENTITLEMENT_ERROR",
  DATA_UNAVAILABLE: "DATA_UNAVAILABLE",
  DATA_QUALITY_ERROR: "DATA_QUALITY_ERROR",
  LEAKAGE_ERROR: "LEAKAGE_ERROR",
  MODEL_ERROR: "MODEL_ERROR",
  POLICY_REJECTED: "POLICY_REJECTED",
  RISK_REJECTED: "RISK_REJECTED",
  INTEGRATION_UNAVAILABLE: "INTEGRATION_UNAVAILABLE",
  EXECUTION_REJECTED: "EXECUTION_REJECTED",
  TIMEOUT: "TIMEOUT",
  CONFLICT: "CONFLICT",
  ALREADY_PROCESSED: "ALREADY_PROCESSED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;
export type AgentFailureCode = (typeof AgentFailureCode)[keyof typeof AgentFailureCode];

/**
 * Which failure codes a caller may safely retry at all (Section 06
 * §23/21 — "Only retry operations that are safely retryable... Never
 * blindly retry bookmaker execution, payment-like operations, Telegram
 * publication without idempotency, settlement mutation"). This is
 * deliberately conservative: only codes that describe a transient
 * condition where nothing external has already happened are retryable.
 * EXECUTION_REJECTED, ALREADY_PROCESSED, and POLICY/RISK rejections are
 * never retryable — retrying them either repeats a decision that was
 * already final or risks a duplicate real-world action.
 */
const RETRYABLE_FAILURE_CODES: ReadonlySet<AgentFailureCode> = new Set([AgentFailureCode.DATA_UNAVAILABLE, AgentFailureCode.TIMEOUT, AgentFailureCode.INTEGRATION_UNAVAILABLE]);

export function isRetryableFailureCode(code: AgentFailureCode): boolean {
  return RETRYABLE_FAILURE_CODES.has(code);
}

export interface AgentFailure {
  readonly code: AgentFailureCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly context?: Readonly<Record<string, unknown>>;
}

export function agentFailure(code: AgentFailureCode, message: string, context?: Record<string, unknown>): AgentFailure {
  return { code, message, retryable: isRetryableFailureCode(code), ...(context !== undefined ? { context } : {}) };
}

/** Maps this codebase's existing `AppError` hierarchy (`@sport-os/shared`) onto an `AgentFailureCode` — the seam between "a dependency threw" and "the orchestrator records a typed failure," never a bare `catch { return undefined }`. */
export function toAgentFailure(error: unknown): AgentFailure {
  if (error instanceof AppError) {
    const code = mapErrorKindToFailureCode(error.kind, error.code);
    return agentFailure(code, error.message, { originalKind: error.kind, originalCode: error.code, ...error.context });
  }
  if (error instanceof Error) {
    return agentFailure(AgentFailureCode.INTERNAL_ERROR, error.message);
  }
  return agentFailure(AgentFailureCode.INTERNAL_ERROR, "An unknown, non-Error value was thrown.", { value: String(error) });
}

function mapErrorKindToFailureCode(kind: ErrorKind, code: string | undefined): AgentFailureCode {
  switch (kind) {
    case ErrorKind.VALIDATION:
      return AgentFailureCode.VALIDATION_ERROR;
    case ErrorKind.AUTHENTICATION:
    case ErrorKind.AUTHORIZATION:
      return code?.includes("ENTITLEMENT") ? AgentFailureCode.ENTITLEMENT_ERROR : AgentFailureCode.AUTHORIZATION_ERROR;
    case ErrorKind.INTEGRATION:
      return AgentFailureCode.INTEGRATION_UNAVAILABLE;
    case ErrorKind.DEPENDENCY_UNAVAILABLE:
      return AgentFailureCode.DATA_UNAVAILABLE;
    case ErrorKind.NOT_IMPLEMENTED:
      return AgentFailureCode.INTEGRATION_UNAVAILABLE;
    case ErrorKind.CONFIGURATION:
    case ErrorKind.INTERNAL:
    default:
      return AgentFailureCode.INTERNAL_ERROR;
  }
}
