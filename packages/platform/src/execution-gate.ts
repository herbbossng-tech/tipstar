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
