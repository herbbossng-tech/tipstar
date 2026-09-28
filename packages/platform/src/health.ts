import type { Environment, ISODateString } from "@sport-os/shared";

export const ServiceReadiness = {
  READY: "ready",
  NOT_READY: "not_ready",
  UNKNOWN: "unknown",
} as const;
export type ServiceReadiness = (typeof ServiceReadiness)[keyof typeof ServiceReadiness];

export const ApplicationStatus = {
  OK: "ok",
  DEGRADED: "degraded",
  DOWN: "down",
} as const;
export type ApplicationStatus = (typeof ApplicationStatus)[keyof typeof ApplicationStatus];

/** Health/status shape (Section 01 — Health/Observability Foundation). Must never include secrets. */
export interface HealthReport {
  readonly status: ApplicationStatus;
  readonly environment: Environment;
  readonly version: string;
  readonly timestamp: ISODateString;
  readonly services: Readonly<Record<string, ServiceReadiness>>;
}

export interface HealthService {
  getHealth(): Promise<HealthReport>;
}

/**
 * Derives overall status from a services readiness map: DOWN if any
 * required service is not_ready, DEGRADED if any is unknown, else OK.
 * Deliberately simple, deterministic, and secret-free.
 */
export function buildHealthReport(environment: Environment, version: string, services: Readonly<Record<string, ServiceReadiness>>): HealthReport {
  const values = Object.values(services);
  const status: ApplicationStatus = values.includes(ServiceReadiness.NOT_READY)
    ? ApplicationStatus.DOWN
    : values.includes(ServiceReadiness.UNKNOWN)
      ? ApplicationStatus.DEGRADED
      : ApplicationStatus.OK;
  return { status, environment, version, timestamp: new Date().toISOString(), services };
}
