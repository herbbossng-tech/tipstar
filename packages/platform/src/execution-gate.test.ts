import { describe, expect, it } from "vitest";
import {
  buildStandardGateChecks,
  createEntitlementGateCheck,
  createIdentityGateCheck,
  createIntegrationAvailabilityGateCheck,
  createLicenseGateCheck,
  createRiskGateCheck,
  GlobalExecutionGate,
  STANDARD_GATE_CHECK_ORDER,
  type ExecutionRequestContext,
  type GateCheck,
  type GateCheckResult,
} from "./execution-gate.js";
import { InMemoryUsersRepository } from "./identity.js";
import { Entitlement, LicenseStatus, Role, isLicenseUsable, type License, type LicenseService } from "./license.js";
import { UserStatus } from "./roles.js";

function buildLicense(overrides: Partial<License> = {}): License {
  return { userId: "user-1", status: LicenseStatus.ACTIVE, role: Role.USER, entitlements: [], issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: null, ...overrides };
}

/** A minimal `LicenseService` test double — no InMemory/DatabaseLicenseService plumbing needed since these tests only exercise createLicenseGateCheck/createEntitlementGateCheck against a fixed License. */
function licenseServiceStub(license: License | undefined): LicenseService {
  return {
    getLicense: async () => license,
    hasEntitlement: async (_userId, entitlement) => (license ? isLicenseUsable(license) && license.entitlements.includes(entitlement) : false),
    getLicenseForUser: async () => license,
    getEntitlements: async () => license?.entitlements ?? [],
    getLimits: async () => undefined,
    isLicenseActive: (candidate) => isLicenseUsable(candidate),
    checkLimit: () => true,
  };
}

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

describe("createIdentityGateCheck", () => {
  it("denies a userId with no matching user record", async () => {
    const check = createIdentityGateCheck(new InMemoryUsersRepository());
    const result = await check.check({ ...CONTEXT, userId: "99999999-9999-9999-9999-999999999999" });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe("IDENTITY_UNKNOWN");
  });

  it("denies a suspended user", async () => {
    const users = new InMemoryUsersRepository();
    const user = await users.upsertFromTelegram({ telegramUserId: 1, username: "a", firstName: "A", lastName: undefined, languageCode: undefined, isPremium: false, authenticatedAt: "2026-01-01T00:00:00Z" });
    await users.updateStatus(user.id, UserStatus.SUSPENDED);
    const check = createIdentityGateCheck(users);
    const result = await check.check({ ...CONTEXT, userId: user.id });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe("IDENTITY_INACTIVE");
  });

  it("allows an active, known user", async () => {
    const users = new InMemoryUsersRepository();
    const user = await users.upsertFromTelegram({ telegramUserId: 1, username: "a", firstName: "A", lastName: undefined, languageCode: undefined, isPremium: false, authenticatedAt: "2026-01-01T00:00:00Z" });
    const check = createIdentityGateCheck(users);
    const result = await check.check({ ...CONTEXT, userId: user.id });
    expect(result.allowed).toBe(true);
  });
});

describe("createLicenseGateCheck", () => {
  it("denies when the user has no license at all", async () => {
    const check = createLicenseGateCheck(licenseServiceStub(undefined));
    const result = await check.check(CONTEXT);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe("LICENSE_NOT_FOUND");
  });

  it("denies an expired/suspended license", async () => {
    const check = createLicenseGateCheck(licenseServiceStub(buildLicense({ status: LicenseStatus.EXPIRED })));
    const result = await check.check(CONTEXT);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe("LICENSE_INACTIVE");
  });

  it("allows an active license", async () => {
    const check = createLicenseGateCheck(licenseServiceStub(buildLicense({ status: LicenseStatus.ACTIVE })));
    const result = await check.check(CONTEXT);
    expect(result.allowed).toBe(true);
  });
});

describe("createEntitlementGateCheck", () => {
  it("allows unconditionally when the resolver says no entitlement is required for this action", async () => {
    const check = createEntitlementGateCheck(licenseServiceStub(undefined), () => undefined);
    const result = await check.check(CONTEXT);
    expect(result.allowed).toBe(true);
  });

  it("denies when the resolved entitlement is required but the license does not carry it", async () => {
    const check = createEntitlementGateCheck(licenseServiceStub(buildLicense({ entitlements: [] })), () => Entitlement.FOOTBALL_AUTOMATION);
    const result = await check.check(CONTEXT);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe("ENTITLEMENT_MISSING");
  });

  it("allows when the license carries the resolved required entitlement", async () => {
    const check = createEntitlementGateCheck(licenseServiceStub(buildLicense({ entitlements: [Entitlement.FOOTBALL_AUTOMATION] })), () => Entitlement.FOOTBALL_AUTOMATION);
    const result = await check.check(CONTEXT);
    expect(result.allowed).toBe(true);
  });
});

describe("createRiskGateCheck — value and risk remain separate; this check never computes a risk decision itself", () => {
  it("denies when no risk evaluation was supplied at all", async () => {
    const check = createRiskGateCheck();
    const result = await check.check(CONTEXT);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe("RISK_EVALUATION_MISSING");
  });

  it("denies when the supplied risk evaluation was not approved", async () => {
    const check = createRiskGateCheck();
    const result = await check.check({ ...CONTEXT, metadata: { risk: { riskApproved: false, riskCode: "MAX_STAKE_EXCEEDED", riskReason: "Stake too large." } } });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe("MAX_STAKE_EXCEEDED");
      expect(result.reason).toBe("Stake too large.");
    }
  });

  it("allows when the supplied risk evaluation was approved", async () => {
    const check = createRiskGateCheck();
    const result = await check.check({ ...CONTEXT, metadata: { risk: { riskApproved: true } } });
    expect(result.allowed).toBe(true);
  });
});

describe("createIntegrationAvailabilityGateCheck", () => {
  it("denies when the integration reports itself unavailable — 'never fake execution'", async () => {
    const check = createIntegrationAvailabilityGateCheck({ isAvailable: async () => false });
    const result = await check.check(CONTEXT);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe("INTEGRATION_NOT_AVAILABLE");
  });

  it("allows when the integration reports itself available", async () => {
    const check = createIntegrationAvailabilityGateCheck({ isAvailable: async () => true });
    const result = await check.check(CONTEXT);
    expect(result.allowed).toBe(true);
  });
});

describe("buildStandardGateChecks — assembles the real checks in STANDARD_GATE_CHECK_ORDER order", () => {
  it("produces checks named in exactly STANDARD_GATE_CHECK_ORDER's order", () => {
    const users = new InMemoryUsersRepository();
    const checks = buildStandardGateChecks({
      users,
      licenseService: licenseServiceStub(buildLicense()),
      resolveRequiredEntitlement: () => undefined,
      integration: { isAvailable: async () => true },
    });
    expect(checks.map((c) => c.name)).toEqual(STANDARD_GATE_CHECK_ORDER);
  });

  it("end-to-end: a fully valid request is authorized through every real check", async () => {
    const users = new InMemoryUsersRepository();
    const user = await users.upsertFromTelegram({ telegramUserId: 1, username: "a", firstName: "A", lastName: undefined, languageCode: undefined, isPremium: false, authenticatedAt: "2026-01-01T00:00:00Z" });
    const gate = new GlobalExecutionGate(
      buildStandardGateChecks({
        users,
        licenseService: licenseServiceStub(buildLicense({ entitlements: [Entitlement.FOOTBALL_AUTOMATION] })),
        resolveRequiredEntitlement: () => Entitlement.FOOTBALL_AUTOMATION,
        integration: { isAvailable: async () => true },
      }),
    );
    const result = await gate.authorize({ userId: user.id, agentType: "football_automation", action: "execute_ticket", metadata: { risk: { riskApproved: true } } });
    expect(result.authorized).toBe(true);
  });

  it("end-to-end: stops at 'risk' even though license/entitlement pass, when no risk evaluation is present", async () => {
    const users = new InMemoryUsersRepository();
    const user = await users.upsertFromTelegram({ telegramUserId: 1, username: "a", firstName: "A", lastName: undefined, languageCode: undefined, isPremium: false, authenticatedAt: "2026-01-01T00:00:00Z" });
    const gate = new GlobalExecutionGate(
      buildStandardGateChecks({
        users,
        licenseService: licenseServiceStub(buildLicense({ entitlements: [Entitlement.FOOTBALL_AUTOMATION] })),
        resolveRequiredEntitlement: () => Entitlement.FOOTBALL_AUTOMATION,
        integration: { isAvailable: async () => true },
      }),
    );
    const result = await gate.authorize({ userId: user.id, agentType: "football_automation", action: "execute_ticket" });
    expect(result.authorized).toBe(false);
    if (!result.authorized) expect(result.failedCheck).toBe("risk");
  });

  it("end-to-end: never reaches 'integration_availability' when 'identity' already fails", async () => {
    const gate = new GlobalExecutionGate(
      buildStandardGateChecks({
        users: new InMemoryUsersRepository(),
        licenseService: licenseServiceStub(buildLicense()),
        resolveRequiredEntitlement: () => undefined,
        integration: { isAvailable: async () => true },
      }),
    );
    const result = await gate.authorize({ userId: "99999999-9999-9999-9999-999999999999", agentType: "football_automation", action: "execute_ticket", metadata: { risk: { riskApproved: true } } });
    expect(result.authorized).toBe(false);
    if (!result.authorized) expect(result.failedCheck).toBe("identity");
  });
});
