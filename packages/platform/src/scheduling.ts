/**
 * Scheduling/background jobs contract (Section 01 — PLATFORM). Gated by
 * the JOBS_ENABLED config flag. No concrete scheduler (cron, queue, etc.)
 * is wired up yet — that selection is a later-section concern once real
 * jobs (settlement polling, weekly reports, risk resets) exist to run.
 */
export interface JobDefinition {
  readonly id: string;
  readonly name: string;
  /** Cron-style schedule expression. Interpretation is the concrete scheduler's responsibility. */
  readonly schedule: string;
  readonly enabled: boolean;
}

export type JobHandler = () => Promise<void>;

export interface JobScheduler {
  register(job: JobDefinition, handler: JobHandler): void;
  start(): void;
  stop(): void;
}
