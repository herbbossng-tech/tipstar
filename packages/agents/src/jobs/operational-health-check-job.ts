import type { InvocationsRepository } from "@sport-os/agent-core";
import { AuditOutcome, evaluateOperationalHealth, JobFailureCategory, OperationalJobType, OperationalSubsystem, SubsystemHealthStatus, type AuditService, type OperationalJobRecord, type OperationalJobsRepository, type SubsystemProbeResult } from "@sport-os/platform";
import { generateId } from "@sport-os/shared";
import type { PerformanceLedgerReader } from "../weekly-report-service.js";
import type { JobHandler, JobHandlerResult } from "./worker.js";

/**
 * OPERATIONAL_HEALTH_CHECK (Section 11 Part F/Q). The fourth, previously
 * unimplemented job type — closes the gap where `evaluateOperationalHealth()`
 * (a PURE function over caller-supplied probe results) had no actual
 * caller resolving real probes and nowhere to deliver its result.
 *
 * Deliberately bounded, honest probes:
 *  - DATABASE/JOB_RUNNER: a real read against `operational_jobs` itself —
 *    if this job is executing at all, the job runner's own persistence is
 *    reachable, so one probe call stands in for both signals.
 *  - AGENT_FRAMEWORK: a real read against `agent_invocations` via the
 *    already-existing `InvocationsRepository`.
 *  - REPORTING_SUBSYSTEM: a real read against `performance_ledger` via
 *    the already-existing `PerformanceLedgerReader` (Section 11's own
 *    reporting read surface).
 *  - SETTLEMENT_SUBSYSTEM: a real bounded probe against `settlements`
 *    when the caller supplies one (Section 12 Part Y — "the existing
 *    settlement probe returning UNKNOWN must be resolved if there is a
 *    safe real health signal"; there is one, the same bounded-read
 *    pattern every other probe here already uses). The probe function
 *    itself is caller-supplied, never constructed in this package, so
 *    this handler takes on no new Supabase-client-specific dependency
 *    type — it only calls whatever bounded read the caller hands it and
 *    classifies the result exactly like every other probe. Falls back
 *    to the prior, honest `UNKNOWN` when no probe is supplied.
 *  - TELEGRAM_INTEGRATION/FOOTBALL_DATA_PROVIDER/ODDS_PROVIDER/
 *    AVIATOR_DATA_BOUNDARY: this job never makes an outbound call to any
 *    external provider (no fake reachability claims) — it only reports
 *    `NOT_CONFIGURED` when the caller-supplied config flag says the
 *    integration isn't configured, and `UNKNOWN` (never `HEALTHY`) when
 *    it is configured but this check does not attempt to reach it. "If a
 *    provider is intentionally not configured, report NOT_CONFIGURED,
 *    never HEALTHY" (§Q) — and the converse holds too: never claim
 *    HEALTHY for a reachability this job never actually tested.
 *
 * On success, the full subsystem breakdown is recorded via the existing
 * `AuditService` (§P/§Z) — never a new health-history table — so the
 * admin Audit view (where built) remains the one place to see past
 * health check outcomes. When `overallStatus` is UNAVAILABLE, the job
 * itself fails (retryable) so it is visible in /adminjobs and the Jobs
 * admin screen, carrying a `health_check_failure` audit record (§Z).
 */
export interface OperationalHealthCheckJobDependencies {
  readonly operationalJobs: OperationalJobsRepository;
  readonly agentInvocations: InvocationsRepository;
  readonly performanceLedger: PerformanceLedgerReader;
  /** A bounded read against `settlements` (e.g. `select id limit 1`) — caller-supplied so this package takes on no Supabase-client-specific dependency. Omit to report SETTLEMENT_SUBSYSTEM as the honest `UNKNOWN` rather than skipping the probe silently. */
  readonly settlementsConnectivityProbe?: (() => Promise<unknown>) | undefined;
  readonly audit: AuditService;
  readonly telegramConfigured: boolean;
  readonly footballDataProviderConfigured: boolean;
  readonly oddsProviderConfigured: boolean;
  readonly aviatorDataConfigured: boolean;
}

async function probeViaCall(fn: () => Promise<unknown>): Promise<SubsystemProbeResult> {
  try {
    await fn();
    return { status: SubsystemHealthStatus.HEALTHY };
  } catch (error) {
    return { status: SubsystemHealthStatus.UNAVAILABLE, reason: error instanceof Error ? error.message : String(error) };
  }
}

function configuredOrUnknown(configured: boolean): SubsystemProbeResult {
  if (!configured) return { status: SubsystemHealthStatus.NOT_CONFIGURED, reason: "Not configured." };
  return { status: SubsystemHealthStatus.UNKNOWN, reason: "Configured; this health check does not make an outbound reachability call." };
}

export class OperationalHealthCheckJobHandler implements JobHandler {
  readonly jobType: OperationalJobType = OperationalJobType.OPERATIONAL_HEALTH_CHECK;

  constructor(private readonly deps: OperationalHealthCheckJobDependencies) {}

  async handle(job: OperationalJobRecord): Promise<JobHandlerResult> {
    const databaseAndJobRunnerProbe = await probeViaCall(() => this.deps.operationalJobs.listRecent({ limit: 1 }));
    const agentFrameworkProbe = await probeViaCall(() => this.deps.agentInvocations.listRecentByAgentType(undefined, 1));
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const reportingProbe = await probeViaCall(() => this.deps.performanceLedger.listForPeriod(yesterday.toISOString(), now.toISOString(), "LIVE"));
    const settlementProbe = this.deps.settlementsConnectivityProbe ? await probeViaCall(this.deps.settlementsConnectivityProbe) : { status: SubsystemHealthStatus.UNKNOWN, reason: "No settlements-connectivity probe was supplied to this handler." };

    const report = evaluateOperationalHealth({
      [OperationalSubsystem.DATABASE]: databaseAndJobRunnerProbe,
      [OperationalSubsystem.JOB_RUNNER]: databaseAndJobRunnerProbe,
      [OperationalSubsystem.AGENT_FRAMEWORK]: agentFrameworkProbe,
      [OperationalSubsystem.REPORTING_SUBSYSTEM]: reportingProbe,
      [OperationalSubsystem.SETTLEMENT_SUBSYSTEM]: settlementProbe,
      [OperationalSubsystem.TELEGRAM_INTEGRATION]: configuredOrUnknown(this.deps.telegramConfigured),
      [OperationalSubsystem.FOOTBALL_DATA_PROVIDER]: configuredOrUnknown(this.deps.footballDataProviderConfigured),
      [OperationalSubsystem.ODDS_PROVIDER]: configuredOrUnknown(this.deps.oddsProviderConfigured),
      [OperationalSubsystem.AVIATOR_DATA_BOUNDARY]: configuredOrUnknown(this.deps.aviatorDataConfigured),
    });

    const outcome: AuditOutcome = report.overallStatus === SubsystemHealthStatus.UNAVAILABLE ? AuditOutcome.FAILURE : AuditOutcome.SUCCESS;
    await this.deps.audit.record({
      actor: job.createdBy,
      action: outcome === AuditOutcome.FAILURE ? "health_check_failure" : "operational_health_check",
      resource: "operational_health",
      resourceId: job.jobId,
      outcome,
      requestId: generateId(),
      metadata: { overallStatus: report.overallStatus, subsystems: report.subsystems },
    });

    if (report.overallStatus === SubsystemHealthStatus.UNAVAILABLE) {
      const unavailable = Object.entries(report.subsystems)
        .filter(([, probe]) => probe.status === SubsystemHealthStatus.UNAVAILABLE)
        .map(([subsystem]) => subsystem);
      return { ok: false, category: JobFailureCategory.INTEGRATION_UNAVAILABLE, message: `Subsystem(s) unavailable: ${unavailable.join(", ")}.` };
    }
    return { ok: true };
  }
}
