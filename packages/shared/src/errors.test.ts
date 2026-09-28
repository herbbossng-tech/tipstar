import { describe, expect, it } from "vitest";
import {
  AppError,
  AuthenticationError,
  AuthorizationError,
  ConfigurationError,
  DependencyUnavailableError,
  ErrorKind,
  IntegrationError,
  InternalError,
  NotImplementedError,
  ValidationError,
} from "./errors.js";

describe("typed error hierarchy", () => {
  it.each([
    [ValidationError, ErrorKind.VALIDATION],
    [AuthenticationError, ErrorKind.AUTHENTICATION],
    [AuthorizationError, ErrorKind.AUTHORIZATION],
    [ConfigurationError, ErrorKind.CONFIGURATION],
    [IntegrationError, ErrorKind.INTEGRATION],
    [DependencyUnavailableError, ErrorKind.DEPENDENCY_UNAVAILABLE],
    [InternalError, ErrorKind.INTERNAL],
  ] as const)("%s carries kind %s and is an AppError", (ErrorClass, expectedKind) => {
    const error = new ErrorClass({ message: "boom" });
    expect(error).toBeInstanceOf(AppError);
    expect(error.kind).toBe(expectedKind);
    expect(error.message).toBe("boom");
    expect(error.timestamp).toBeTruthy();
  });

  it("NotImplementedError produces a clear, safe message from a feature name", () => {
    const error = new NotImplementedError("FootballService.analyze");
    expect(error.kind).toBe(ErrorKind.NOT_IMPLEMENTED);
    expect(error.message).toBe("FootballService.analyze is not implemented yet.");
  });

  it("freezes context so callers cannot mutate it after construction", () => {
    const error = new ValidationError({ message: "bad input", context: { field: "email" } });
    expect(() => {
      (error.context as Record<string, unknown>).field = "tampered";
    }).toThrow();
  });

  it("toJSON() produces a safe, serializable shape without exposing the raw stack", () => {
    const error = new IntegrationError({ message: "provider unreachable", correlationId: "req-1" });
    const json = error.toJSON();
    expect(json).toMatchObject({ name: "IntegrationError", kind: ErrorKind.INTEGRATION, message: "provider unreachable", correlationId: "req-1" });
    expect(json).not.toHaveProperty("stack");
  });
});
