import type { AgentType } from "./types.js";

/**
 * Side-effect levels (Section 06 — Agent Core Contract). A total order,
 * least to most consequential — see `assertNoSideEffectEscalation` below,
 * the one place this ordering matters mechanically.
 *
 * READ_ONLY        — reads data, produces nothing new.
 * ANALYSIS         — computes/derives a result from data already read.
 * PROPOSAL         — produces a candidate artifact (e.g. a ticket
 *                     proposal) that nothing downstream has acted on yet.
 * REQUESTED_ACTION — asks a gated boundary (GlobalExecutionGate, a
 *                     publishing policy) to do something; the agent
 *                     itself performs no external action.
 * EXECUTION        — the agent (through a permitted integration) actually
 *                     causes an external, real-world effect.
 */
export const SideEffectLevel = {
  READ_ONLY: "read_only",
  ANALYSIS: "analysis",
  PROPOSAL: "proposal",
  REQUESTED_ACTION: "requested_action",
  EXECUTION: "execution",
} as const;
export type SideEffectLevel = (typeof SideEffectLevel)[keyof typeof SideEffectLevel];

/** Total order used to detect escalation — index position is the only thing that matters, not the numeric value. */
const SIDE_EFFECT_LEVEL_ORDER: readonly SideEffectLevel[] = [
  SideEffectLevel.READ_ONLY,
  SideEffectLevel.ANALYSIS,
  SideEffectLevel.PROPOSAL,
  SideEffectLevel.REQUESTED_ACTION,
  SideEffectLevel.EXECUTION,
];

function levelRank(level: SideEffectLevel): number {
  return SIDE_EFFECT_LEVEL_ORDER.indexOf(level);
}

/**
 * Declared statically per agent instance (Section 06 §5). This is not the
 * same thing as `Agent.capabilities: readonly string[]` in types.ts (a
 * free-form list of feature-level capability names, e.g. "produce
 * probabilities") — `AgentDeclaration` is the structured metadata
 * envelope the orchestrator and audit trail rely on mechanically:
 * required entitlements, allowed input/output shapes by name, and the
 * agent's declared, immutable ceiling side-effect level.
 */
export interface AgentDeclaration {
  readonly agentId: string;
  readonly agentType: AgentType;
  readonly version: string;
  /** Free-form capability names (Section 06 §7's "read football data", "request model inference", ...). */
  readonly capabilities: readonly string[];
  /**
   * `@sport-os/platform`'s `Entitlement` string values (e.g.
   * `Entitlement.FOOTBALL_ANALYSIS`) — typed as `readonly string[]` here
   * rather than importing the real enum, since `platform` already
   * depends on `agent-core` and the reverse import would be circular.
   * Callers in `@sport-os/agents` (which depends on both) pass real
   * `Entitlement` values; their string-literal type is assignable here
   * without a cast.
   */
  readonly requiredEntitlements: readonly string[];
  /** Named input/output contract identifiers — not full JSON Schemas (no such validation library is in this codebase), but enough for the orchestrator to reject a message whose declared type isn't in either list before it ever reaches the agent. */
  readonly allowedInputs: readonly string[];
  readonly allowedOutputs: readonly string[];
  /** Other agent types this agent may request via a Command (Section 06 §18/19) — never an arbitrary direct call. */
  readonly dependencies: readonly AgentType[];
  /** The ceiling this agent may ever report for a single invocation — see assertNoSideEffectEscalation. */
  readonly sideEffectLevel: SideEffectLevel;
}

/**
 * Enforces "Agents must not silently escalate their side-effect level"
 * (Section 06 §5): the level an invocation actually reports
 * (`actualLevel`, e.g. what `AgentInvocationRecord.sideEffectLevel` ends
 * up as) may never exceed the agent's own static declaration. Returns
 * `true` when `actualLevel` is within the declared ceiling, `false` on
 * an escalation attempt — callers (the orchestrator) turn a `false` into
 * a rejected invocation, never a silently-widened one.
 */
export function isWithinDeclaredSideEffectLevel(declaration: AgentDeclaration, actualLevel: SideEffectLevel): boolean {
  return levelRank(actualLevel) <= levelRank(declaration.sideEffectLevel);
}
