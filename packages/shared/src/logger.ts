import type { Environment } from "./types.js";
import { redact } from "./redact.js";

export const LogSeverity = {
  DEBUG: "debug",
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
} as const;
export type LogSeverity = (typeof LogSeverity)[keyof typeof LogSeverity];

const SEVERITY_ORDER: Record<LogSeverity, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface LogMetadata {
  readonly [key: string]: unknown;
}

/** Structured log entry shape (Section 01 — Logging). */
export interface LogEntry {
  readonly timestamp: string;
  readonly environment: Environment;
  readonly service: string;
  readonly agent?: string;
  readonly requestId?: string;
  readonly severity: LogSeverity;
  readonly message: string;
  readonly metadata?: LogMetadata;
}

export interface Logger {
  debug(message: string, metadata?: LogMetadata): void;
  info(message: string, metadata?: LogMetadata): void;
  warn(message: string, metadata?: LogMetadata): void;
  error(message: string, metadata?: LogMetadata): void;
  /** Returns a child logger bound to a request/event ID for correlated logs. */
  withRequestId(requestId: string): Logger;
}

export interface StructuredLoggerOptions {
  readonly environment: Environment;
  readonly service: string;
  readonly agent?: string;
  readonly minSeverity?: LogSeverity;
  readonly sink?: (entry: LogEntry) => void;
}

/**
 * Structured JSON logger. Every metadata object passed to a log call is
 * redacted before serialization so secrets can never leak into log output,
 * even if a caller accidentally includes one.
 */
export class StructuredLogger implements Logger {
  private readonly environment: Environment;
  private readonly service: string;
  private readonly agent: string | undefined;
  private readonly requestId: string | undefined;
  private readonly minSeverity: LogSeverity;
  private readonly sink: (entry: LogEntry) => void;

  constructor(options: StructuredLoggerOptions, requestId?: string) {
    this.environment = options.environment;
    this.service = options.service;
    this.agent = options.agent;
    this.requestId = requestId;
    this.minSeverity = options.minSeverity ?? "info";
    this.sink = options.sink ?? ((entry) => console.log(JSON.stringify(entry)));
  }

  private log(severity: LogSeverity, message: string, metadata?: LogMetadata): void {
    if (SEVERITY_ORDER[severity] < SEVERITY_ORDER[this.minSeverity]) return;
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      environment: this.environment,
      service: this.service,
      ...(this.agent !== undefined ? { agent: this.agent } : {}),
      ...(this.requestId !== undefined ? { requestId: this.requestId } : {}),
      severity,
      message,
      ...(metadata !== undefined ? { metadata: redact(metadata) as LogMetadata } : {}),
    };
    this.sink(entry);
  }

  debug(message: string, metadata?: LogMetadata): void {
    this.log("debug", message, metadata);
  }
  info(message: string, metadata?: LogMetadata): void {
    this.log("info", message, metadata);
  }
  warn(message: string, metadata?: LogMetadata): void {
    this.log("warn", message, metadata);
  }
  error(message: string, metadata?: LogMetadata): void {
    this.log("error", message, metadata);
  }

  withRequestId(requestId: string): Logger {
    return new StructuredLogger(
      {
        environment: this.environment,
        service: this.service,
        ...(this.agent !== undefined ? { agent: this.agent } : {}),
        minSeverity: this.minSeverity,
        sink: this.sink,
      },
      requestId,
    );
  }
}
