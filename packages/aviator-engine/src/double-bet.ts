/**
 * "Double bet" boundary (Section 01 — Aviator Engine Boundary). The
 * precise product semantics of a "double bet" (e.g. two concurrent stakes
 * at different cash-out targets on the same round, vs. a martingale-style
 * stake progression) are not defined in the Master Blueprint V1.0 excerpt
 * available to this section — see docs/architecture/OPEN_QUESTIONS.md.
 * This boundary only fixes that a strategy decision of this kind exists
 * and is distinct from a single signal; no strategy logic is implemented.
 */
export interface DoubleBetPlan {
  readonly signalId: string;
  readonly legs: readonly { readonly cashOutMultiplier: number; readonly stakeWeight: number }[];
}

export interface DoubleBetStrategy {
  plan(signalId: string): Promise<DoubleBetPlan | undefined>;
}
