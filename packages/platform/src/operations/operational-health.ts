import type { ISODateString } from "@sport-os/shared";

/**
 * Section 11 Part Q — system/integration health. Richer than Section
 * 01's `HealthService`/`ApplicationStatus` (OK/DEGRADED/DOWN) — that
 * contract is unused outside its own file today and stays untouched;
 * this is new, additive code for the admin "system health" view, which
 * needs to distinguish "intentionally not configured" from "configured
 * but failing" (§Q: "If a provider is intentionally not configured,
 * report NOT_CONFIGURED, not HEALTHY").
 *
 * `evaluateOperationalHealth()` is a PURE function over already-
 * resolved probe results — exactly like `GlobalExecutionGate.
 * authorize()` is pure over already-resolved `GateCheck` results. It
 * never pings a database, calls Telegram, or does any I/O itself; the
 * caller (an edge function, a job handler) resolves each subsystem's
 * real status and passes it in. This keeps the decision logic testable
 * without a live Supabase/Telegram connection, and keeps this package
 * free of new runtime dependencies.
 */

export const SubsystemHealthStatus = {
  HEALTHY: "HEALTHY",
  DEGRADED: "DEGRADED",
  UNAVAILABLE: "UNAVAILABLE",
  NOT_CONFIGURED: "NOT_CONFIGURED",
  UNKNOWN: "UNKNOWN",
} as const;
export type SubsystemHealthStatus = (typeof SubsystemHealthStatus)[keyof typeof SubsystemHealthStatus];

export const OperationalSubsystem = {
  DATABASE: "database",
  TELEGRAM_INTEGRATION: "telegram_integration",
  FOOTBALL_DATA_PROVIDER: "football_data_provider",
  ODDS_PROVIDER: "odds_provider",
  AVIATOR_DATA_BOUNDARY: "aviator_data_boundary",
  JOB_RUNNER: "job_runner",
  AGENT_FRAMEWORK: "agent_framework",
  SETTLEMENT_SUBSYSTEM: "settlement_subsystem",
  REPORTING_SUBSYSTEM: "reporting_subsystem",
} as const;
export type OperationalSubsystem = (typeof OperationalSubsystem)[keyof typeof OperationalSubsystem];

export interface SubsystemProbeResult {
  readonly status: SubsystemHealthStatus;
  /** Required whenever status is not HEALTHY — "degraded/unavailable reason" (§S). Never required for HEALTHY, since there is nothing to explain. */
  readonly reason?: string;
}

export interface OperationalHealthReport {
  readonly generatedAt: ISODateString;
  readonly overallStatus: SubsystemHealthStatus;
  readonly subsystems: Readonly<Record<OperationalSubsystem, SubsystemProbeResult>>;
}

/** Worst-status-wins ordering (HEALTHY is best, UNAVAILABLE and NOT_CONFIGURED both worse than DEGRADED, UNKNOWN is the least informative so it ranks alongside them rather than below). */
const STATUS_SEVERITY: Readonly<Record<SubsystemHealthStatus, number>> = {
  [SubsystemHealthStatus.HEALTHY]: 0,
  [SubsystemHealthStatus.DEGRADED]: 1,
  [SubsystemHealthStatus.NOT_CONFIGURED]: 2,
  [SubsystemHealthStatus.UNKNOWN]: 2,
  [SubsystemHealthStatus.UNAVAILABLE]: 3,
};

/**
 * Deterministic aggregation: the overall status is the single worst
 * subsystem status present. A platform with every optional provider
 * `NOT_CONFIGURED` is correctly `NOT_CONFIGURED` overall, never silently
 * reported as `HEALTHY`.
 */
export function evaluateOperationalHealth(probes: Readonly<Record<OperationalSubsystem, SubsystemProbeResult>>): OperationalHealthReport {
  let overallStatus: SubsystemHealthStatus = SubsystemHealthStatus.HEALTHY;
  for (const probe of Object.values(probes)) {
    if (STATUS_SEVERITY[probe.status] > STATUS_SEVERITY[overallStatus]) {
      overallStatus = probe.status;
    }
  }
  return { generatedAt: new Date().toISOString(), overallStatus, subsystems: probes };
}
