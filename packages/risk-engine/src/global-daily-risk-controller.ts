import { ValidationError } from "@sport-os/shared";

/**
 * Locked risk-controller states (Section 01 — Global Daily Risk
 * Controller Boundary). Do not add a state here without documenting why.
 */
export const RiskControllerState = {
  ACTIVE: "active",
  DAILY_TARGET_REACHED: "daily_target_reached",
  DAILY_STOP_LOSS_REACHED: "daily_stop_loss_reached",
} as const;
export type RiskControllerState = (typeof RiskControllerState)[keyof typeof RiskControllerState];

export interface GlobalDailyRiskControllerOptions {
  /** Positive number: cumulative P/L reaching this value locks the day as a win. */
  readonly dailyTarget: number;
  /** Positive number (a magnitude): cumulative P/L reaching -dailyStopLoss locks the day as a loss. */
  readonly dailyStopLoss: number;
}

/**
 * GlobalDailyRiskController — real, deterministic implementation. This is
 * pure arithmetic control-flow over numbers callers supply (never a
 * prediction/statistics source), so it is safe and appropriate to
 * implement for real in Section 01. It must eventually sit ABOVE the
 * Signal Engine — no automation package in this codebase may execute
 * anything while `isExecutionAllowed()` is false.
 */
export class GlobalDailyRiskController {
  private readonly dailyTarget: number;
  private readonly dailyStopLoss: number;
  private cumulativePnL = 0;
  private state: RiskControllerState = RiskControllerState.ACTIVE;

  constructor(options: GlobalDailyRiskControllerOptions) {
    if (options.dailyTarget <= 0) {
      throw new ValidationError({ message: "dailyTarget must be a positive number.", context: { dailyTarget: options.dailyTarget } });
    }
    if (options.dailyStopLoss <= 0) {
      throw new ValidationError({ message: "dailyStopLoss must be a positive number (a magnitude).", context: { dailyStopLoss: options.dailyStopLoss } });
    }
    this.dailyTarget = options.dailyTarget;
    this.dailyStopLoss = options.dailyStopLoss;
  }

  /** Records the P/L delta of one settled outcome and re-evaluates the lock state. */
  recordResult(amount: number): void {
    if (this.state !== RiskControllerState.ACTIVE) return; // already locked for the day — ignore further results.
    this.cumulativePnL += amount;
    if (this.cumulativePnL >= this.dailyTarget) {
      this.state = RiskControllerState.DAILY_TARGET_REACHED;
    } else if (this.cumulativePnL <= -this.dailyStopLoss) {
      this.state = RiskControllerState.DAILY_STOP_LOSS_REACHED;
    }
  }

  getState(): RiskControllerState {
    return this.state;
  }

  getCumulativePnL(): number {
    return this.cumulativePnL;
  }

  /** The automatic kill switch: false whenever a daily lock state has been reached. */
  isExecutionAllowed(): boolean {
    return this.state === RiskControllerState.ACTIVE;
  }

  /** Starts a new day: clears cumulative P/L and returns to ACTIVE. */
  reset(): void {
    this.cumulativePnL = 0;
    this.state = RiskControllerState.ACTIVE;
  }
}
