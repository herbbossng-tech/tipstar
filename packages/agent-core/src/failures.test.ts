import { AuthorizationError, DependencyUnavailableError, IntegrationError, NotImplementedError, ValidationError } from "@sport-os/shared";
import { describe, expect, it } from "vitest";
import { agentFailure, AgentFailureCode, isRetryableFailureCode, toAgentFailure } from "./failures.js";

describe("failures.ts — typed agent failure codes", () => {
  it("maps ValidationError to VALIDATION_ERROR", () => {
    const failure = toAgentFailure(new ValidationError({ message: "bad input" }));
    expect(failure.code).toBe(AgentFailureCode.VALIDATION_ERROR);
    expect(failure.retryable).toBe(false);
  });

  it("maps AuthorizationError to AUTHORIZATION_ERROR by default, ENTITLEMENT_ERROR when the code says so", () => {
    const generic = toAgentFailure(new AuthorizationError({ message: "denied", code: "AUTHORIZATION_ADMIN_REQUIRED" }));
    expect(generic.code).toBe(AgentFailureCode.AUTHORIZATION_ERROR);

    const entitlement = toAgentFailure(new AuthorizationError({ message: "no entitlement", code: "ENTITLEMENT_DENIED" }));
    expect(entitlement.code).toBe(AgentFailureCode.ENTITLEMENT_ERROR);
  });

  it("maps IntegrationError and NotImplementedError to INTEGRATION_UNAVAILABLE (retryable)", () => {
    expect(toAgentFailure(new IntegrationError({ message: "bot api down" })).code).toBe(AgentFailureCode.INTEGRATION_UNAVAILABLE);
    expect(toAgentFailure(new NotImplementedError("BookmakerIntegration.execute")).code).toBe(AgentFailureCode.INTEGRATION_UNAVAILABLE);
    expect(toAgentFailure(new IntegrationError({ message: "bot api down" })).retryable).toBe(true);
  });

  it("maps DependencyUnavailableError to DATA_UNAVAILABLE (retryable)", () => {
    const failure = toAgentFailure(new DependencyUnavailableError({ message: "db unreachable" }));
    expect(failure.code).toBe(AgentFailureCode.DATA_UNAVAILABLE);
    expect(failure.retryable).toBe(true);
  });

  it("maps a plain Error and a non-Error throw to INTERNAL_ERROR without fabricating detail", () => {
    expect(toAgentFailure(new Error("boom")).code).toBe(AgentFailureCode.INTERNAL_ERROR);
    expect(toAgentFailure("a bare string throw").code).toBe(AgentFailureCode.INTERNAL_ERROR);
  });

  it("never retries EXECUTION_REJECTED, ALREADY_PROCESSED, POLICY_REJECTED, or RISK_REJECTED — these describe a final decision, not a transient condition", () => {
    for (const code of [AgentFailureCode.EXECUTION_REJECTED, AgentFailureCode.ALREADY_PROCESSED, AgentFailureCode.POLICY_REJECTED, AgentFailureCode.RISK_REJECTED]) {
      expect(isRetryableFailureCode(code)).toBe(false);
      expect(agentFailure(code, "x").retryable).toBe(false);
    }
  });

  it("marks DATA_UNAVAILABLE, TIMEOUT, and INTEGRATION_UNAVAILABLE as retryable", () => {
    for (const code of [AgentFailureCode.DATA_UNAVAILABLE, AgentFailureCode.TIMEOUT, AgentFailureCode.INTEGRATION_UNAVAILABLE]) {
      expect(isRetryableFailureCode(code)).toBe(true);
    }
  });
});
