import type { OperationalJobType } from "@sport-os/platform";
import { describe, expect, it, vi } from "vitest";
import { sleep, WorkerRunner } from "./worker-runner.js";

class FakeLogger {
  readonly errors: unknown[][] = [];
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(message: string, metadata?: unknown): void {
    this.errors.push([message, metadata]);
  }
  withRequestId() {
    return this as never;
  }
}

function fakeWorker(runOnceImpl: (jobType: OperationalJobType) => Promise<"claimed" | "empty">) {
  return { runOnce: vi.fn(runOnceImpl) } as never;
}

describe("WorkerRunner — Section 12 Parts I/J/L", () => {
  it("TEST 1: polls every registered job type each iteration when nothing is eligible, then sleeps before the next pass", async () => {
    const calls: OperationalJobType[] = [];
    const worker = fakeWorker(async (jobType) => {
      calls.push(jobType);
      return "empty";
    });
    const runner = new WorkerRunner(worker, { jobTypes: ["PERFORMANCE_SNAPSHOT", "OPERATIONAL_HEALTH_CHECK"] as never, pollIntervalMs: 5, logger: new FakeLogger() as never });

    const started = runner.start();
    // Let a couple of iterations happen, then stop — a real production
    // loop runs forever, so the test bounds it explicitly rather than
    // asserting on an exact iteration count (timer-dependent).
    await sleep(20);
    runner.stop();
    await started;

    expect(calls).toContain("PERFORMANCE_SNAPSHOT");
    expect(calls).toContain("OPERATIONAL_HEALTH_CHECK");
  });

  it("TEST 2: does NOT sleep between job types in the same pass when a job was claimed — only between passes with nothing to do", async () => {
    let callCount = 0;
    const worker = fakeWorker(async () => {
      callCount += 1;
      // First 5 claims succeed immediately (simulating a busy queue); then go idle.
      return callCount <= 5 ? "claimed" : "empty";
    });
    const runner = new WorkerRunner(worker, { jobTypes: ["PERFORMANCE_SNAPSHOT"] as never, pollIntervalMs: 1000, logger: new FakeLogger() as never });

    const started = runner.start();
    // If claimed runs never slept, 5 claims plus the first "empty" call
    // all happen well within 50ms — proving no accidental throttling of
    // a busy queue.
    await sleep(50);
    runner.stop();
    await started;

    expect(callCount).toBeGreaterThanOrEqual(6);
  });

  it("TEST 3: a runOnce() rejection is caught and logged — never crashes the loop", async () => {
    let calls = 0;
    const worker = fakeWorker(async () => {
      calls += 1;
      if (calls === 1) throw new Error("transient DB error");
      return "empty";
    });
    const logger = new FakeLogger();
    const runner = new WorkerRunner(worker, { jobTypes: ["PERFORMANCE_SNAPSHOT"] as never, pollIntervalMs: 5, logger: logger as never });

    const started = runner.start();
    await sleep(20);
    runner.stop();
    await started;

    expect(logger.errors.length).toBeGreaterThan(0);
    expect(calls).toBeGreaterThan(1); // the loop kept going after the failure
  });

  it("TEST 4: stop() lets the current iteration finish rather than aborting mid-call — the loop always awaits its in-flight runOnce()", async () => {
    let resolveSlow: (() => void) | undefined;
    const worker = fakeWorker(async () => {
      await new Promise<void>((resolve) => {
        resolveSlow = resolve;
      });
      return "empty";
    });
    const runner = new WorkerRunner(worker, { jobTypes: ["PERFORMANCE_SNAPSHOT"] as never, pollIntervalMs: 5, logger: new FakeLogger() as never });

    const started = runner.start();
    await sleep(10); // let the slow runOnce() start
    runner.stop();
    expect(runner.isStopped).toBe(true);

    // start() must not have resolved yet — the slow call is still in flight.
    let finishedEarly = false;
    void started.then(() => {
      finishedEarly = true;
    });
    await sleep(10);
    expect(finishedEarly).toBe(false);

    resolveSlow?.();
    await started;
    expect(finishedEarly).toBe(true);
  });

  it("TEST 5: calling start() twice returns the SAME run, never a second concurrent loop", () => {
    const worker = fakeWorker(async () => "empty");
    const runner = new WorkerRunner(worker, { jobTypes: ["PERFORMANCE_SNAPSHOT"] as never, pollIntervalMs: 5, logger: new FakeLogger() as never });
    const first = runner.start();
    const second = runner.start();
    expect(first).toBe(second);
    runner.stop();
  });
});
