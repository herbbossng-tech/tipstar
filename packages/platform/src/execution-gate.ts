import type { UUID } from "@sport-os/shared";
import type { UsersRepository } from "./identity.js";
import { licenseAllows, type Entitlement, type LicenseService } from "./license.js";
import { isActiveUser } from "./roles.js";

/**
 * GlobalExecutionGate (Section 01 — Global Execution Gate Foundation).
 *
 * Conceptual pipeline:
 *   identity check -> license check -> entitlement check -> risk check
 *   -> integration availability -> execution authorization
 *
 * This module implements the ORCHESTRATION (a fixed-order pipeline that
 * stops at the first denial) as real, tested architecture. Each
 * individual check's actual business logic is injected by the caller —
 * Section 01 does not implement real identity/license/risk decisions
 * here, only the contract and the control flow above them.
 *
 * Section 07 §26 adds the first REAL `GateCheck` implementations below
 * (`createIdentityGateCheck`/`createLicenseGateCheck`/
 * `createEntitlementGateCheck`/`createRiskGateCheck`/
 * `createIntegrationAvailabilityGateCheck` + `buildStandardGateChecks`),
 * wired in exactly `STANDARD_GATE_CHECK_ORDER`'s order. This remains the
 * ONE `GlobalExecutionGate` in the codebase — no agent constructs a
 * second one, and no agent may reach an execution adapter except through
 * `AgentOrchestrator.dispatch()`'s existing `ExecutionAuthorizer.
 * authorize()` call (see `agent-core/orchestrator.ts`).
 */

export interface ExecutionRequestContext {
  readonly userId: string;
  readonly agentType: string;
  readonly action: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type GateCheckResult = { readonly allowed: true } | { readonly allowed: false; readonly reason: string; readonly code: string };

export interface GateCheck {
  readonly name: string;
  check(context: ExecutionRequestContext): Promise<GateCheckResult> | GateCheckResult;
}

export type GateAuthorizationResult =
  | { readonly authorized: true }
  | { readonly authorized: false; readonly failedCheck: string; readonly reason: string; readonly code: string };

/**
 * The standard, locked check order every deployment of the gate must use
 * unless a genuine architectural reason says otherwise (see
 * docs/architecture/OPEN_QUESTIONS.md if one arises).
 */
export const STANDARD_GATE_CHECK_ORDER = ["identity", "license", "entitlement", "risk", "integration_availability"] as const;

export class GlobalExecutionGate {
  constructor(private readonly checks: readonly GateCheck[]) {}

  async authorize(context: ExecutionRequestContext): Promise<GateAuthorizationResult> {
    for (const check of this.checks) {
      const result = await check.check(context);
      if (!result.allowed) {
        return { authorized: false, failedCheck: check.name, reason: result.reason, code: result.code };
      }
    }
    return { authorized: true };
  }
}

// ============================================================
// Concrete GateCheck implementations (Section 07 §26/J)
// ============================================================

/** "identity" — resolves the caller to a real, ACTIVE application user. Never re-verifies Telegram initData (that is Section 02's job, strictly earlier); this only confirms the already-resolved userId is a real, non-suspended/non-disabled account. */
export function createIdentityGateCheck(users: UsersRepository): GateCheck {
  return {
    name: "identity",
    async check(context: ExecutionRequestContext): Promise<GateCheckResult> {
      const user = await users.findById(context.userId as UUID);
      if (!user) {
        return { allowed: false, reason: "No known identity for this user.", code: "IDENTITY_UNKNOWN" };
      }
      if (!isActiveUser({ userId: user.id, role: user.role, status: user.status })) {
        return { allowed: false, reason: `User account status is "${user.status}", not active.`, code: "IDENTITY_INACTIVE" };
      }
      return { allowed: true };
    },
  };
}

/** "license" — the existing `licenseAllows()`/`isLicenseUsable()` foundation, never duplicated here: this check only calls the injected `LicenseService`. */
export function createLicenseGateCheck(licenseService: LicenseService): GateCheck {
  return {
    name: "license",
    async check(context: ExecutionRequestContext): Promise<GateCheckResult> {
      const license = await licenseService.getLicenseForUser(context.userId as UUID);
      if (!license) {
        return { allowed: false, reason: "No license found for this user.", code: "LICENSE_NOT_FOUND" };
      }
      if (!licenseService.isLicenseActive(license)) {
        return { allowed: false, reason: `License status is "${license.status}".`, code: "LICENSE_INACTIVE" };
      }
      return { allowed: true };
    },
  };
}

/**
 * "entitlement" — `resolveRequiredEntitlement` maps an `(agentType, action)`
 * pair to the `Entitlement` it requires (mirroring each agent's own
 * `AgentDeclaration.requiredEntitlements`, e.g. `FOOTBALL_AUTOMATION_AGENT_
 * DECLARATION`). Returning `undefined` means this action requires no
 * entitlement beyond a usable license, which the "license" check already
 * covers — never treated as "deny by default", since that would silently
 * block actions no entitlement was ever meant to gate.
 */
export function createEntitlementGateCheck(licenseService: LicenseService, resolveRequiredEntitlement: (context: ExecutionRequestContext) => Entitlement | undefined): GateCheck {
  return {
    name: "entitlement",
    async check(context: ExecutionRequestContext): Promise<GateCheckResult> {
      const required = resolveRequiredEntitlement(context);
      if (required === undefined) {
        return { allowed: true };
      }
      const license = await licenseService.getLicenseForUser(context.userId as UUID);
      if (!license || !licenseAllows(license, required)) {
        return { allowed: false, reason: `This action requires the "${required}" entitlement.`, code: "ENTITLEMENT_MISSING" };
      }
      return { allowed: true };
    },
  };
}

/**
 * "risk" — value and risk remain separate outputs (§21): this check never
 * computes a risk decision itself. It reads a PRE-COMPUTED result the
 * caller placed on `context.metadata.risk` (the shape produced by
 * `@sport-os/risk-engine`'s `evaluateTicketRisk`/`evaluateAviatorDailyRisk`
 * — `{ riskApproved, riskCode?, riskReason? }`), the same way `context.
 * metadata.invocationId` is already threaded through by `AgentOrchestrator.
 * dispatch()`. `platform` does not depend on `risk-engine` — this keeps
 * the two packages decoupled while still enforcing that no execution can
 * be authorized without SOME risk evaluation having actually run.
 */
export interface RiskGateMetadata {
  readonly riskApproved: boolean;
  readonly riskCode?: string;
  readonly riskReason?: string;
}

export function createRiskGateCheck(): GateCheck {
  return {
    name: "risk",
    check(context: ExecutionRequestContext): GateCheckResult {
      const risk = context.metadata?.risk as RiskGateMetadata | undefined;
      if (risk === undefined) {
        return { allowed: false, reason: "No risk evaluation was supplied for this execution request.", code: "RISK_EVALUATION_MISSING" };
      }
      if (!risk.riskApproved) {
        return { allowed: false, reason: risk.riskReason ?? "Risk evaluation rejected this request.", code: risk.riskCode ?? "RISK_REJECTED" };
      }
      return { allowed: true };
    },
  };
}

/** Duck-typed against `ExecutionIntegration` (`@sport-os/agents`) — `platform` cannot depend on `agents` (the reverse dependency already exists), so this check only asks for the one method it actually needs. */
export interface IntegrationAvailabilityCheckTarget {
  isAvailable(): Promise<boolean>;
}

/** "integration_availability" — "if no permitted bookmaker integration exists, return NOT_AVAILABLE... never fake execution." A false `isAvailable()` denies here, before any execution adapter is ever reached. */
export function createIntegrationAvailabilityGateCheck(integration: IntegrationAvailabilityCheckTarget): GateCheck {
  return {
    name: "integration_availability",
    async check(): Promise<GateCheckResult> {
      const available = await integration.isAvailable();
      if (!available) {
        return { allowed: false, reason: "No permitted execution integration is currently available.", code: "INTEGRATION_NOT_AVAILABLE" };
      }
      return { allowed: true };
    },
  };
}

export interface StandardGateCheckDependencies {
  readonly users: UsersRepository;
  readonly licenseService: LicenseService;
  readonly resolveRequiredEntitlement: (context: ExecutionRequestContext) => Entitlement | undefined;
  readonly integration: IntegrationAvailabilityCheckTarget;
}

/** Assembles the real checks in exactly `STANDARD_GATE_CHECK_ORDER`'s order — the one place a caller should build a production `GlobalExecutionGate` from, rather than hand-assembling the check list itself. */
export function buildStandardGateChecks(deps: StandardGateCheckDependencies): readonly GateCheck[] {
  return [
    createIdentityGateCheck(deps.users),
    createLicenseGateCheck(deps.licenseService),
    createEntitlementGateCheck(deps.licenseService, deps.resolveRequiredEntitlement),
    createRiskGateCheck(),
    createIntegrationAvailabilityGateCheck(deps.integration),
  ];
}
