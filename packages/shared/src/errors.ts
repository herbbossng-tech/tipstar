/**
 * Typed application error hierarchy (Section 01 — Error Handling).
 *
 * `message` must always be safe to show a user or log in production —
 * never put secrets or stack-trace-level detail there. Diagnostic detail
 * belongs in `context`, which callers must still be careful never to
 * populate with credentials (see @sport-os/shared's `redact`).
 */
export const ErrorKind = {
  VALIDATION: "validation_error",
  AUTHENTICATION: "authentication_error",
  AUTHORIZATION: "authorization_error",
  CONFIGURATION: "configuration_error",
  INTEGRATION: "integration_error",
  DEPENDENCY_UNAVAILABLE: "dependency_unavailable",
  NOT_IMPLEMENTED: "not_implemented",
  INTERNAL: "internal_error",
} as const;
export type ErrorKind = (typeof ErrorKind)[keyof typeof ErrorKind];

export interface AppErrorInit {
  readonly message: string;
  readonly context?: Record<string, unknown>;
  readonly correlationId?: string;
  readonly cause?: unknown;
}

export class AppError extends Error {
  readonly kind: ErrorKind;
  readonly context: Readonly<Record<string, unknown>>;
  readonly timestamp: string;
  readonly correlationId: string | undefined;

  constructor(kind: ErrorKind, init: AppErrorInit) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = "AppError";
    this.kind = kind;
    this.context = Object.freeze({ ...(init.context ?? {}) });
    this.timestamp = new Date().toISOString();
    this.correlationId = init.correlationId;
  }

  /** Safe to serialize directly into an API response or log line. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      kind: this.kind,
      message: this.message,
      context: this.context,
      timestamp: this.timestamp,
      correlationId: this.correlationId,
    };
  }
}

export class ValidationError extends AppError {
  constructor(init: AppErrorInit) {
    super(ErrorKind.VALIDATION, init);
    this.name = "ValidationError";
  }
}

export class AuthenticationError extends AppError {
  constructor(init: AppErrorInit) {
    super(ErrorKind.AUTHENTICATION, init);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends AppError {
  constructor(init: AppErrorInit) {
    super(ErrorKind.AUTHORIZATION, init);
    this.name = "AuthorizationError";
  }
}

export class ConfigurationError extends AppError {
  constructor(init: AppErrorInit) {
    super(ErrorKind.CONFIGURATION, init);
    this.name = "ConfigurationError";
  }
}

export class IntegrationError extends AppError {
  constructor(init: AppErrorInit) {
    super(ErrorKind.INTEGRATION, init);
    this.name = "IntegrationError";
  }
}

export class DependencyUnavailableError extends AppError {
  constructor(init: AppErrorInit) {
    super(ErrorKind.DEPENDENCY_UNAVAILABLE, init);
    this.name = "DependencyUnavailableError";
  }
}

/**
 * The explicit "not yet implemented" boundary (Section 01, Backend/Service
 * Boundaries): every service/engine method that has no real implementation
 * yet must throw this rather than silently returning fabricated data.
 */
export class NotImplementedError extends AppError {
  constructor(featureName: string, init: Omit<AppErrorInit, "message"> = {}) {
    super(ErrorKind.NOT_IMPLEMENTED, { ...init, message: `${featureName} is not implemented yet.` });
    this.name = "NotImplementedError";
  }
}

export class InternalError extends AppError {
  constructor(init: AppErrorInit) {
    super(ErrorKind.INTERNAL, init);
    this.name = "InternalError";
  }
}
