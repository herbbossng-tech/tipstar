import { GlobalDailyRiskController } from "@sport-os/risk-engine";
import { describe, expect, it } from "vitest";
import { recordRealizedResult } from "./risk-recording.js";

describe("recordRealizedResult — Section 08 §21", () => {
  it("records a real, settled net P&L into the SHARED controller", () => {
    const controller = new GlobalDailyRiskController({ dailyTarget: 1000, dailyStopLoss: 500 });
    recordRealizedResult(controller, { amount: 150, currency: "NGN" });
    expect(controller.getCumulativePnL()).toBe(150);
  });

  it("never records anything for an unsettled/unexecuted outcome (netPnl === null) — no fabricated financial event", () => {
    const controller = new GlobalDailyRiskController({ dailyTarget: 1000, dailyStopLoss: 500 });
    recordRealizedResult(controller, null);
    expect(controller.getCumulativePnL()).toBe(0);
    expect(controller.getState()).toBe("active");
  });

  it("a real, negative realized P&L can trip the daily stop-loss, exactly like any other recordResult() call", () => {
    const controller = new GlobalDailyRiskController({ dailyTarget: 1000, dailyStopLoss: 100 });
    recordRealizedResult(controller, { amount: -150, currency: "NGN" });
    expect(controller.isExecutionAllowed()).toBe(false);
    expect(controller.getState()).toBe("daily_stop_loss_reached");
  });

  it("never constructs its own controller — always mutates the exact shared instance it's given", () => {
    const controllerA = new GlobalDailyRiskController({ dailyTarget: 1000, dailyStopLoss: 500 });
    const controllerB = new GlobalDailyRiskController({ dailyTarget: 1000, dailyStopLoss: 500 });
    recordRealizedResult(controllerA, { amount: 100, currency: "NGN" });
    expect(controllerA.getCumulativePnL()).toBe(100);
    expect(controllerB.getCumulativePnL()).toBe(0);
  });
});
