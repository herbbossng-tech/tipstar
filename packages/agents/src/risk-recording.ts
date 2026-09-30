import type { GlobalDailyRiskController } from "@sport-os/risk-engine";
import type { Money } from "@sport-os/settlement-engine";

/**
 * Realized P&L → Global Daily Risk Controller feedback (Section 08 §21).
 * "Section 07's GlobalDailyRiskController remains authoritative.
 * Settlement must feed actual realized P&L into the controller/ledger
 * where the existing architecture requires it. Do not create another
 * daily P&L ledger. Daily result: actual realized P&L, not predicted
 * EV. Do not update the global daily risk ledger from an unexecuted
 * ticket."
 *
 * This is the ONE place a real, settled outcome's `netPnl` is ever fed
 * into the SHARED `GlobalDailyRiskController` — cross-sport (a football
 * `TicketSettlement.netPnl` and an Aviator `DoubleBetSettlement.netPnl`
 * are both `Money | null`, so one function covers both), and never
 * called from `AviatorRiskAgent`/`SettlementAgent`/`PerformanceAgent`
 * themselves (each stays read-only/orchestration-only — see
 * `aviator/risk-agent.ts`'s own doc comment: "recording a settled
 * outcome belongs to whichever code actually observes that outcome...
 * not this eligibility check"). Never constructs its own controller —
 * takes the caller's SHARED instance, exactly like `AviatorRiskAgent`
 * does.
 */
export function recordRealizedResult(controller: GlobalDailyRiskController, netPnl: Money | null): void {
  if (netPnl === null) return; // no real financial outcome yet (unsettled, or never executed) — never invented, never recorded as a predicted/expected value.
  controller.recordResult(netPnl.amount);
}
