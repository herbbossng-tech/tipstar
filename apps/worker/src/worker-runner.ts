import type { OperationalJobType } from "@sport-os/platform";
import type { Logger } from "@sport-os/shared";
import type { OperationalJobWorker } from "@sport-os/agents";

/**
 * Section 12 Parts I/J/L — the deployed process boundary around
 * `OperationalJobWorker` that Section 11 never built
 * (`OPEN_QUESTIONS.md` #33). `OperationalJobWorker.runOnce()` itself
 * already does the atomic claim; this class is only the polling loop
 * and graceful-shutdown wrapper around it — it adds no new claiming or
 * retry logic of its own.
 *
 * Graceful shutdown (Part L): `stop()` only ever sets a flag the loop
 * checks BETWEEN job types and BETWEEN polls — it never aborts a job
 * mid-`runOnce()`. Each `runOnce()` call already runs a claimed job to
 * a terminal outcome (SUCCEEDED/FAILED/retried) before returning, so
 * there is no "half-finished job" state for a shutdown to abandon; a
 * process that dies without ever calling `stop()` (e.g. `kill -9`,
 * host failure) instead relies on the existing stale-RUNNING lease
 * reclaim in `claim_next_operational_job()` — the same safety net every
 * crash scenario already has, shutdown or not.
 */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** An interruptible sleep — `cancel()` resolves it immediately, so a shutdown signal never has to wait out a full idle poll interval. */
function interruptibleSleep(ms: number): { readonly promise: Promise<void>; readonly cancel: () => void } {
  let timeoutHandle: ReturnType<typeof setTimeout>;
  let resolveNow: () => void;
  const promise = new Promise<void>((resolve) => {
    resolveNow = resolve;
    timeoutHandle = setTimeout(resolve, ms);
  });
  return { promise, cancel: () => {
    clearTimeout(timeoutHandle);
    resolveNow();
  } };
}

export interface WorkerRunnerOptions {
  readonly jobTypes: readonly OperationalJobType[];
  readonly pollIntervalMs: number;
  readonly logger: Logger;
}

export class WorkerRunner {
  private stopped = false;
  private runningLoop: Promise<void> | undefined;
  private cancelCurrentSleep: (() => void) | undefined;

  constructor(
    private readonly worker: OperationalJobWorker,
    private readonly options: WorkerRunnerOptions,
  ) {}

  /** Starts the poll loop. Resolves only after `stop()` is called and the in-flight iteration finishes — callers should not `await` this on the main thread without also wiring a shutdown signal (see `index.ts`). */
  start(): Promise<void> {
    if (this.runningLoop) return this.runningLoop;
    this.runningLoop = this.loop();
    return this.runningLoop;
  }

  /** Requests a graceful stop. Does not interrupt a job currently executing (see the class doc comment) — but immediately wakes an idle poll wait, so shutdown never has to sit out a full `pollIntervalMs` doing nothing. */
  stop(): void {
    this.stopped = true;
    this.cancelCurrentSleep?.();
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      let claimedAny = false;
      for (const jobType of this.options.jobTypes) {
        if (this.stopped) break;
        try {
          const outcome = await this.worker.runOnce(jobType);
          if (outcome === "claimed") claimedAny = true;
        } catch (error) {
          // A claim/transition call itself failing (e.g. a transient DB
          // error) must never crash the whole worker process — log and
          // keep polling. The job itself stays QUEUED/RUNNING and the
          // stale-lease reclaim covers a RUNNING job this leaves stuck.
          this.options.logger.error("Worker runOnce() failed unexpectedly", { jobType, error: error instanceof Error ? error.message : String(error) });
        }
      }
      if (this.stopped) break;
      if (!claimedAny) {
        const { promise, cancel } = interruptibleSleep(this.options.pollIntervalMs);
        this.cancelCurrentSleep = cancel;
        await promise;
        this.cancelCurrentSleep = undefined;
      }
    }
  }
}
