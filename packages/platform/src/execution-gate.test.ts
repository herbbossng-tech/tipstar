import { describe, expect, it } from "vitest";
import { GlobalExecutionGate, type ExecutionRequestContext, type GateCheck, type GateCheckResult } from "./execution-gate.js";

function passingCheck(name: string): GateCheck {
  return { name, check: (): GateCheckResult => ({ allowed: true }) };
}

function failingCheck(name: string, reason: string, code: string): GateCheck {
  return { name, check: (): GateCheckResult => ({ allowed: false, reason, code }) };
}

const CONTEXT: ExecutionRequestContext = { userId: "user-1", agentType: "football_decision", action: "publish_ticket" };

describe("GlobalExecutionGate", () => {
  it("authorizes when every check in the pipeline passes", async () => {
    const gate = new GlobalExecutionGate([passingCheck("identity"), passingCheck("license"), passingCheck("risk")]);
    const result = await gate.authorize(CONTEXT);
    expect(result.authorized).toBe(true);
  });

  it("denies at the first failing check and does not report a later check name", async () => {
    const gate = new GlobalExecutionGate([passingCheck("identity"), failingCheck("license", "License expired", "LICENSE_EXPIRED"), passingCheck("risk")]);
    const result = await gate.authorize(CONTEXT);
    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.failedCheck).toBe("license");
      expect(result.code).toBe("LICENSE_EXPIRED");
    }
  });

  it("respects check order: an earlier failure short-circuits a later check entirely", async () => {
    let laterCheckRan = false;
    const laterCheck: GateCheck = {
      name: "risk",
      check: () => {
        laterCheckRan = true;
        return { allowed: true };
      },
    };
    const gate = new GlobalExecutionGate([failingCheck("identity", "Unknown user", "IDENTITY_UNKNOWN"), laterCheck]);

    await gate.authorize(CONTEXT);

    expect(laterCheckRan).toBe(false);
  });

  it("supports async checks", async () => {
    const asyncCheck: GateCheck = { name: "integration_availability", check: async () => ({ allowed: true }) };
    const gate = new GlobalExecutionGate([asyncCheck]);
    const result = await gate.authorize(CONTEXT);
    expect(result.authorized).toBe(true);
  });

  it("authorizes trivially with an empty check pipeline", async () => {
    const gate = new GlobalExecutionGate([]);
    const result = await gate.authorize(CONTEXT);
    expect(result.authorized).toBe(true);
  });
});
