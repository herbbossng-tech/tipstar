import { describe, expect, it } from "vitest";
import { ValidationError } from "@sport-os/shared";
import { GlobalDailyRiskController, RiskControllerState } from "./global-daily-risk-controller.js";

describe("GlobalDailyRiskController", () => {
  it("starts ACTIVE with zero cumulative P/L", () => {
    const controller = new GlobalDailyRiskController({ dailyTarget: 100, dailyStopLoss: 50 });
    expect(controller.getState()).toBe(RiskControllerState.ACTIVE);
    expect(controller.getCumulativePnL()).toBe(0);
    expect(controller.isExecutionAllowed()).toBe(true);
  });

  it("rejects a non-positive dailyTarget", () => {
    expect(() => new GlobalDailyRiskController({ dailyTarget: 0, dailyStopLoss: 50 })).toThrow(ValidationError);
  });

  it("rejects a non-positive dailyStopLoss", () => {
    expect(() => new GlobalDailyRiskController({ dailyTarget: 100, dailyStopLoss: -10 })).toThrow(ValidationError);
  });

  it("locks DAILY_TARGET_REACHED once cumulative P/L meets the target", () => {
    const controller = new GlobalDailyRiskController({ dailyTarget: 100, dailyStopLoss: 50 });
    controller.recordResult(60);
    controller.recordResult(40);
    expect(controller.getState()).toBe(RiskControllerState.DAILY_TARGET_REACHED);
    expect(controller.isExecutionAllowed()).toBe(false);
  });

  it("locks DAILY_STOP_LOSS_REACHED once cumulative P/L drops to the loss magnitude", () => {
    const controller = new GlobalDailyRiskController({ dailyTarget: 100, dailyStopLoss: 50 });
    controller.recordResult(-30);
    controller.recordResult(-20);
    expect(controller.getState()).toBe(RiskControllerState.DAILY_STOP_LOSS_REACHED);
    expect(controller.isExecutionAllowed()).toBe(false);
  });

  it("stays ACTIVE while cumulative P/L is strictly between the thresholds", () => {
    const controller = new GlobalDailyRiskController({ dailyTarget: 100, dailyStopLoss: 50 });
    controller.recordResult(30);
    controller.recordResult(-10);
    expect(controller.getState()).toBe(RiskControllerState.ACTIVE);
  });

  it("acts as a kill switch: once locked, further results are ignored", () => {
    const controller = new GlobalDailyRiskController({ dailyTarget: 100, dailyStopLoss: 50 });
    controller.recordResult(100);
    controller.recordResult(-1000); // must not un-lock or crash the controller
    expect(controller.getState()).toBe(RiskControllerState.DAILY_TARGET_REACHED);
    expect(controller.getCumulativePnL()).toBe(100);
  });

  it("reset() returns the controller to ACTIVE with zero P/L for a new day", () => {
    const controller = new GlobalDailyRiskController({ dailyTarget: 100, dailyStopLoss: 50 });
    controller.recordResult(100);
    controller.reset();
    expect(controller.getState()).toBe(RiskControllerState.ACTIVE);
    expect(controller.getCumulativePnL()).toBe(0);
    expect(controller.isExecutionAllowed()).toBe(true);
  });
});
