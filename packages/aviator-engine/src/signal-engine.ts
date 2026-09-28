/**
 * Signal Engine boundary (Section 01 — Aviator Engine Boundary). Turns a
 * confident ensemble output into an actionable signal. The
 * GlobalDailyRiskController (see @sport-os/risk-engine) has higher
 * authority than this engine — no signal may bypass it. No signal logic
 * is implemented yet.
 */
export interface AviatorSignal {
  readonly signalId: string;
  readonly targetMultiplier: number;
  readonly confidence: number;
  readonly generatedAt: string;
}

export interface AviatorSignalEngine {
  generateSignal(): Promise<AviatorSignal | undefined>;
}
