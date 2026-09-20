/**
 * Minimal structured logger contract. Concrete implementations live in
 * @tipstar/audit. Kept here (dependency-free) so every package can log
 * without depending on the audit package's implementation details.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  readonly [key: string]: unknown;
}

export interface Logger {
  log(level: LogLevel, message: string, fields?: LogFields): void;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

/** No-op logger, useful as a safe default in tests and library code. */
export const noopLogger: Logger = {
  log: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
