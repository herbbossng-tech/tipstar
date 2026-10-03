import { describe, expect, it } from "vitest";
import { computeNextAttemptDelayMs, isRetryableJobFailure, isStaleRunningJob, isValidJobTransition, JobFailureCategory, JobStatus } from "./jobs.js";

describe("isValidJobTransition — Section 11 §E", () => {
  it("TEST 1: QUEUED -> RUNNING is valid", () => {
    expect(isValidJobTransition(JobStatus.QUEUED, JobStatus.RUNNING)).toBe(true);
  });
  it("TEST 2: RUNNING -> SUCCEEDED is valid", () => {
    expect(isValidJobTransition(JobStatus.RUNNING, JobStatus.SUCCEEDED)).toBe(true);
  });
  it("TEST 3: RUNNING -> QUEUED is valid (the worker's own automatic retry)", () => {
    expect(isValidJobTransition(JobStatus.RUNNING, JobStatus.QUEUED)).toBe(true);
  });
  it("TEST 4: FAILED -> QUEUED is valid (an explicit admin retry)", () => {
    expect(isValidJobTransition(JobStatus.FAILED, JobStatus.QUEUED)).toBe(true);
  });
  it("TEST 5: SUCCEEDED -> anything is invalid — terminal", () => {
    expect(isValidJobTransition(JobStatus.SUCCEEDED, JobStatus.QUEUED)).toBe(false);
    expect(isValidJobTransition(JobStatus.SUCCEEDED, JobStatus.RUNNING)).toBe(false);
  });
  it("TEST 6: CANCELLED -> anything is invalid — terminal", () => {
    expect(isValidJobTransition(JobStatus.CANCELLED, JobStatus.QUEUED)).toBe(false);
  });
  it("TEST 7: QUEUED -> SUCCEEDED is invalid — cannot skip RUNNING", () => {
    expect(isValidJobTransition(JobStatus.QUEUED, JobStatus.SUCCEEDED)).toBe(false);
  });
});

describe("isRetryableJobFailure — Section 11 §I (safe retry classification)", () => {
  it("TEST 8: DATA_UNAVAILABLE/TIMEOUT/INTEGRATION_UNAVAILABLE/TRANSIENT_DEPENDENCY_FAILURE are retryable", () => {
    expect(isRetryableJobFailure(JobFailureCategory.DATA_UNAVAILABLE)).toBe(true);
    expect(isRetryableJobFailure(JobFailureCategory.TIMEOUT)).toBe(true);
    expect(isRetryableJobFailure(JobFailureCategory.INTEGRATION_UNAVAILABLE)).toBe(true);
    expect(isRetryableJobFailure(JobFailureCategory.TRANSIENT_DEPENDENCY_FAILURE)).toBe(true);
  });
  it("TEST 9: authorization/policy/license/invalid-payload/invalid-transition/permanent-integration failures are NEVER retryable", () => {
    expect(isRetryableJobFailure(JobFailureCategory.AUTHORIZATION_DENIED)).toBe(false);
    expect(isRetryableJobFailure(JobFailureCategory.INVALID_PAYLOAD)).toBe(false);
    expect(isRetryableJobFailure(JobFailureCategory.INVALID_STATE_TRANSITION)).toBe(false);
    expect(isRetryableJobFailure(JobFailureCategory.POLICY_REJECTED)).toBe(false);
    expect(isRetryableJobFailure(JobFailureCategory.LICENSE_DENIED)).toBe(false);
    expect(isRetryableJobFailure(JobFailureCategory.PERMANENT_INTEGRATION_ERROR)).toBe(false);
  });
  it("TEST 10: an unclassified/UNKNOWN failure is never retried by default", () => {
    expect(isRetryableJobFailure(JobFailureCategory.UNKNOWN)).toBe(false);
  });
});

describe("computeNextAttemptDelayMs — exponential backoff, capped", () => {
  it("TEST 11: doubles with each attempt", () => {
    expect(computeNextAttemptDelayMs(1, 1000)).toBe(1000);
    expect(computeNextAttemptDelayMs(2, 1000)).toBe(2000);
    expect(computeNextAttemptDelayMs(3, 1000)).toBe(4000);
  });
  it("TEST 12: never exceeds the configured cap", () => {
    expect(computeNextAttemptDelayMs(20, 1000, 15000)).toBe(15000);
  });
});

describe("isStaleRunningJob — lease/timeout recovery rule", () => {
  it("TEST 13: a job with no startedAt is never stale", () => {
    expect(isStaleRunningJob(undefined, new Date(), 1000)).toBe(false);
  });
  it("TEST 14: a job started well within the lease is not stale", () => {
    const now = new Date("2026-01-01T00:10:00Z");
    expect(isStaleRunningJob("2026-01-01T00:09:00Z", now, 600_000)).toBe(false);
  });
  it("TEST 15: a job started past the lease timeout is stale", () => {
    const now = new Date("2026-01-01T01:00:00Z");
    expect(isStaleRunningJob("2026-01-01T00:00:00Z", now, 600_000)).toBe(true);
  });
});
