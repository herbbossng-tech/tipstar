import type { LogFields, LogLevel, Logger } from "@tipstar/shared";
import { redact } from "./redact.js";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface StructuredLoggerOptions {
  readonly minLevel?: LogLevel;
  readonly sink?: (line: string) => void;
}

/**
 * Structured JSON logger. Every field object passed to a log call is
 * redacted before serialization so secrets can never leak into log output,
 * even if a caller accidentally includes one in `fields`.
 */
export class StructuredLogger implements Logger {
  private readonly minLevel: LogLevel;
  private readonly sink: (line: string) => void;

  constructor(options: StructuredLoggerOptions = {}) {
    this.minLevel = options.minLevel ?? "info";
    this.sink = options.sink ?? ((line) => console.log(line));
  }

  log(level: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...((fields ? (redact(fields) as object) : {})),
    };
    this.sink(JSON.stringify(entry));
  }

  debug(message: string, fields?: LogFields): void {
    this.log("debug", message, fields);
  }
  info(message: string, fields?: LogFields): void {
    this.log("info", message, fields);
  }
  warn(message: string, fields?: LogFields): void {
    this.log("warn", message, fields);
  }
  error(message: string, fields?: LogFields): void {
    this.log("error", message, fields);
  }
}
