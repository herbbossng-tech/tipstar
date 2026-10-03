import { describe, expect, it } from "vitest";
import { evaluateOperationalHealth, OperationalSubsystem, SubsystemHealthStatus } from "./operational-health.js";

function allHealthy(): Record<OperationalSubsystem, { readonly status: SubsystemHealthStatus }> {
  const entries = Object.values(OperationalSubsystem).map((subsystem) => [subsystem, { status: SubsystemHealthStatus.HEALTHY }] as const);
  return Object.fromEntries(entries) as Record<OperationalSubsystem, { readonly status: SubsystemHealthStatus }>;
}

describe("evaluateOperationalHealth — Section 11 §Q", () => {
  it("TEST 1: reports HEALTHY overall when every subsystem is HEALTHY", () => {
    const report = evaluateOperationalHealth(allHealthy());
    expect(report.overallStatus).toBe(SubsystemHealthStatus.HEALTHY);
  });

  it("TEST 2: a single UNAVAILABLE subsystem makes the overall status UNAVAILABLE — worst status wins", () => {
    const probes = { ...allHealthy(), [OperationalSubsystem.DATABASE]: { status: SubsystemHealthStatus.UNAVAILABLE, reason: "connection refused" } };
    const report = evaluateOperationalHealth(probes);
    expect(report.overallStatus).toBe(SubsystemHealthStatus.UNAVAILABLE);
  });

  it("TEST 3: an intentionally NOT_CONFIGURED provider reports NOT_CONFIGURED, never HEALTHY — never fakes availability", () => {
    const probes = { ...allHealthy(), [OperationalSubsystem.ODDS_PROVIDER]: { status: SubsystemHealthStatus.NOT_CONFIGURED, reason: "no provider credential configured" } };
    const report = evaluateOperationalHealth(probes);
    expect(report.subsystems[OperationalSubsystem.ODDS_PROVIDER].status).toBe(SubsystemHealthStatus.NOT_CONFIGURED);
    expect(report.overallStatus).not.toBe(SubsystemHealthStatus.HEALTHY);
  });

  it("TEST 4: a platform where every optional provider is NOT_CONFIGURED is NOT_CONFIGURED overall, never silently HEALTHY", () => {
    const probes = {
      ...allHealthy(),
      [OperationalSubsystem.FOOTBALL_DATA_PROVIDER]: { status: SubsystemHealthStatus.NOT_CONFIGURED },
      [OperationalSubsystem.ODDS_PROVIDER]: { status: SubsystemHealthStatus.NOT_CONFIGURED },
      [OperationalSubsystem.AVIATOR_DATA_BOUNDARY]: { status: SubsystemHealthStatus.NOT_CONFIGURED },
    };
    const report = evaluateOperationalHealth(probes);
    expect(report.overallStatus).toBe(SubsystemHealthStatus.NOT_CONFIGURED);
  });

  it("TEST 5: DEGRADED is worse than HEALTHY but better than UNAVAILABLE", () => {
    const degraded = evaluateOperationalHealth({ ...allHealthy(), [OperationalSubsystem.JOB_RUNNER]: { status: SubsystemHealthStatus.DEGRADED, reason: "high retry rate" } });
    expect(degraded.overallStatus).toBe(SubsystemHealthStatus.DEGRADED);
    const unavailable = evaluateOperationalHealth({ ...allHealthy(), [OperationalSubsystem.JOB_RUNNER]: { status: SubsystemHealthStatus.UNAVAILABLE } });
    expect(unavailable.overallStatus).toBe(SubsystemHealthStatus.UNAVAILABLE);
  });
});
