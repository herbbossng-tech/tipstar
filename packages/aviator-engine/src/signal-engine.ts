import { NotImplementedError } from "@sport-os/shared";

/**
 * Signal Engine boundary (Section 01 — Aviator Engine Boundary; signal
 * states locked in Section 06 — Agent Framework §14: "Allowed signal
 * states: BUY, SELL, WAIT, NO TRADE, MONITOR. Only use states actually
 * defined by the existing Aviator architecture."). Section 01 defined no
 * state at all; `AviatorSignalState` is the minimal, additive extension
 * Section 06 needs to represent one — safe because no concrete
 * `AviatorSignalEngine` implementation exists anywhere in this codebase
 * yet to break. The GlobalDailyRiskController (see @sport-os/risk-engine)
 * has higher authority than this engine — no signal may bypass it. No
 * real signal-generation logic is implemented here; only the shape.
 */
export const AviatorSignalState = {
  BUY: "buy",
  SELL: "sell",
  WAIT: "wait",
  NO_TRADE: "no_trade",
  MONITOR: "monitor",
} as const;
export type AviatorSignalState = (typeof AviatorSignalState)[keyof typeof AviatorSignalState];

export interface AviatorSignal {
  readonly signalId: string;
  readonly state: AviatorSignalState;
  /** A specific cash-out target multiplier — only meaningful for BUY/SELL; null for WAIT/NO_TRADE/MONITOR, never a fabricated number standing in for "no target." */
  readonly targetMultiplier: number | null;
  readonly confidence: number;
  readonly generatedAt: string;
}

export interface AviatorSignalEngine {
  generateSignal(): Promise<AviatorSignal | undefined>;
}

/** The only implementation in this codebase — no real signal-generation logic exists yet. */
export class NotImplementedAviatorSignalEngine implements AviatorSignalEngine {
  async generateSignal(): Promise<AviatorSignal | undefined> {
    throw new NotImplementedError("AviatorSignalEngine.generateSignal");
  }
}
