import { describe, expect, it } from "vitest";
import { ApplicationStatus, ServiceReadiness, buildHealthReport } from "./health.js";

describe("buildHealthReport", () => {
  it("reports OK when every service is ready", () => {
    const report = buildHealthReport("development", "0.1.0", { supabase: ServiceReadiness.READY, telegram: ServiceReadiness.READY });
    expect(report.status).toBe(ApplicationStatus.OK);
  });

  it("reports DOWN when any service is not_ready", () => {
    const report = buildHealthReport("development", "0.1.0", { supabase: ServiceReadiness.NOT_READY, telegram: ServiceReadiness.READY });
    expect(report.status).toBe(ApplicationStatus.DOWN);
  });

  it("reports DEGRADED when a service's readiness is unknown but none are down", () => {
    const report = buildHealthReport("development", "0.1.0", { supabase: ServiceReadiness.READY, telegram: ServiceReadiness.UNKNOWN });
    expect(report.status).toBe(ApplicationStatus.DEGRADED);
  });

  it("DOWN takes priority over DEGRADED when both conditions are present", () => {
    const report = buildHealthReport("development", "0.1.0", { a: ServiceReadiness.NOT_READY, b: ServiceReadiness.UNKNOWN });
    expect(report.status).toBe(ApplicationStatus.DOWN);
  });

  it("never includes any secret-shaped field in the report", () => {
    const report = buildHealthReport("production", "0.1.0", { supabase: ServiceReadiness.READY });
    const serialized = JSON.stringify(report).toLowerCase();
    expect(serialized).not.toMatch(/token|secret|password|api_key/);
  });

  it("carries environment and version through unchanged", () => {
    const report = buildHealthReport("staging", "1.2.3", {});
    expect(report.environment).toBe("staging");
    expect(report.version).toBe("1.2.3");
  });
});
