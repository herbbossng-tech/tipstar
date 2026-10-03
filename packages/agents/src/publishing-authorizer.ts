import { createEntitlementGateCheck, createIdentityGateCheck, createLicenseGateCheck, type Entitlement, type ExecutionRequestContext, type GateCheck, type LicenseService, type UsersRepository } from "@sport-os/platform";

/**
 * Publication authorization (Section 10 §31/§73). "Every protected bot
 * operation verifies server-side at minimum: session/authentication
 * validity, license validity, entitlement, role." "Do NOT use the
 * Global Execution Gate for ordinary publication — publishing a ticket
 * is not executing a ticket." "This remains the ONE GlobalExecutionGate
 * in the codebase — no agent constructs a second one" (platform's
 * execution-gate.ts).
 *
 * `PublishingAuthorizer` resolves this tension: it is duck-type
 * compatible with `@sport-os/agent-core`'s `ExecutionAuthorizer`
 * interface (so `TelegramChannelManagementAgent` can be dispatched
 * through the same `AgentOrchestrator.dispatch()` path every other
 * REQUESTED_ACTION/EXECUTION agent uses — "Agent A -> Typed Agent
 * Message -> Agent Orchestrator -> Policy/Permission Check -> Agent B",
 * never a direct, orchestrator-bypassing call), but it is a wholly
 * SEPARATE class from `GlobalExecutionGate` — never constructed from
 * one, never wrapping one. It reuses the exact same, already-vetted
 * identity/license/entitlement `GateCheck` factories
 * (`createIdentityGateCheck`/`createLicenseGateCheck`/
 * `createEntitlementGateCheck`) the real gate is built from, so the
 * underlying identity/license/entitlement logic is never duplicated —
 * it simply never runs the "risk" or "integration_availability" checks,
 * because publishing has neither a risk decision nor a bookmaker
 * integration to gate on. The Publishing Policy Engine
 * (`evaluatePublicationPolicy` in `@sport-os/telegram`) is the separate,
 * later check for market/league/data-quality/daily-limit/destination
 * business rules — this class only answers "is this user even allowed
 * to request a publication at all."
 */

export interface PublishingAuthorizerDependencies {
  readonly users: UsersRepository;
  readonly licenseService: LicenseService;
  /** Mirrors `StandardGateCheckDependencies.resolveRequiredEntitlement` — e.g. return `Entitlement.TELEGRAM_AUTO_PUBLISH`, or additionally `TELEGRAM_MULTI_CHANNEL` when `context.metadata.destinationCount` is greater than one. */
  readonly resolveRequiredEntitlement: (context: ExecutionRequestContext) => Entitlement | undefined;
}

export type PublishingAuthorizationResult = { readonly authorized: true } | { readonly authorized: false; readonly failedCheck: string; readonly reason: string; readonly code: string };

export class PublishingAuthorizer {
  private readonly checks: readonly GateCheck[];

  constructor(deps: PublishingAuthorizerDependencies) {
    this.checks = [createIdentityGateCheck(deps.users), createLicenseGateCheck(deps.licenseService), createEntitlementGateCheck(deps.licenseService, deps.resolveRequiredEntitlement)];
  }

  async authorize(context: ExecutionRequestContext): Promise<PublishingAuthorizationResult> {
    for (const check of this.checks) {
      const result = await check.check(context);
      if (!result.allowed) {
        return { authorized: false, failedCheck: check.name, reason: result.reason, code: result.code };
      }
    }
    return { authorized: true };
  }
}
