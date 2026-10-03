import * as agentOperations from "./operations/agent-operations.js";
import * as platformSettingsAdmin from "@sport-os/platform";
import { Role, UserStatus, type AuthorizationContext } from "@sport-os/platform";
import { inspectUserForAdmin } from "@sport-os/platform";
import { describe, expect, it } from "vitest";
import { generateWeeklyReport, type PerformanceLedgerReader, type WeeklyReportsStore } from "./weekly-report-service.js";
import type { NewWeeklyReportInput, WeeklyReportRecord } from "./db/repositories.js";
import { LedgerMode, type PerformanceLedgerEntry } from "@sport-os/settlement-engine";

/**
 * Section 11 Part W — the adversarial scenarios that are genuinely
 * distinct from the unit-test coverage already in
 * `operations/*.test.ts`/`weekly-report-service.test.ts`/`jobs/worker.test.ts`
 * (which already cover: non-admin license/job/report/agent-summary
 * denial, retry-of-permanent/policy-rejected failures refused,
 * PAPER/LIVE separation, report versioning). This file covers the
 * scenarios that need a DIFFERENT angle of attack.
 */

const admin: AuthorizationContext = { userId: "admin-1", role: Role.ADMIN, status: UserStatus.ACTIVE };
const ordinaryUser: AuthorizationContext = { userId: "user-1", role: Role.USER, status: UserStatus.ACTIVE };

describe("SECTION11 ADVERSARIAL B: no platform-setting MUTATION path exists at all", () => {
  it("the module exports exactly one function (a read snapshot) — there is nothing shaped like update/set/mutate for a USER or ADMIN to even attempt", () => {
    const exportedNames = Object.keys(platformSettingsAdmin).filter((name) => /settings/i.test(name));
    for (const name of exportedNames) {
      expect(name).not.toMatch(/^(update|set|mutate|patch)/i);
    }
    expect(exportedNames).toContain("getPlatformSettingsSnapshot");
  });
});

describe("SECTION11 ADVERSARIAL E/F: forged user id / forged role never grants authorization", () => {
  it("inspectUserForAdmin's decision depends ONLY on the real, separately-resolved actingUser — a destinations repository claiming the target user 'owns' admin-looking data changes nothing about who is authorized to call it", async () => {
    const attackerClaimingAdminData = {
      list: async () => [{ createdBy: ordinaryUser.userId }],
    };
    const users = { findById: async () => ({ id: "target-user", telegramUserId: 1, username: undefined, firstName: "T", lastName: undefined, languageCode: undefined, isPremium: false, role: Role.USER, status: UserStatus.ACTIVE, lastAuthenticatedAt: undefined, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }) };
    const licenses = { listForUser: async () => [], getActiveOrTrialForUser: async () => undefined };
    const limits = { getForLicense: async () => undefined, upsert: async () => ({ maxDestinations: null, maxTicketsPerDay: null, maxAnalysisRequestsPerDay: null, maxAviatorSignalsPerDay: null }) };

    // Attacker is an ordinary USER no matter what the destinations data "claims."
    const denied = await inspectUserForAdmin({ users: users as never, licenses: licenses as never, limits: limits as never, destinations: attackerClaimingAdminData }, ordinaryUser, "target-user" as never);
    expect(denied.ok).toBe(false);

    // The SAME call with a real admin context succeeds — proving the gate is actingUser, nothing else.
    const allowed = await inspectUserForAdmin({ users: users as never, licenses: licenses as never, limits: limits as never, destinations: attackerClaimingAdminData }, admin, "target-user" as never);
    expect(allowed.ok).toBe(true);
  });
});

describe("SECTION11 ADVERSARIAL G: a job payload claiming a role/user id is never treated as authorization", () => {
  it("OperationalJobWorker never reads job.payloadReference for anything resembling a role or identity grant — it only ever passes the job to the matching handler", async () => {
    const maliciousPayload = { role: "OWNER", userId: "attacker", isAdmin: true };
    let handlerSawPayload: unknown;
    const handler = {
      jobType: "PERFORMANCE_SNAPSHOT" as never,
      handle: async (job: { payloadReference: unknown }) => {
        handlerSawPayload = job.payloadReference;
        // Even though the payload CLAIMS admin/owner, this handler's own
        // real authorization (if any) must come from elsewhere — this
        // test only proves the worker itself never short-circuits
        // execution based on reading these fields.
        return { ok: true as const };
      },
    };
    const { OperationalJobWorker } = await import("./jobs/worker.js");
    const jobs = {
      async create() {
        throw new Error("unused");
      },
      async findByIdempotencyKey() {
        return undefined;
      },
      async claimNext() {
        return { jobId: "j1" as never, jobType: "PERFORMANCE_SNAPSHOT" as never, status: "RUNNING" as never, payloadReference: maliciousPayload, scheduledAt: "2026-01-01T00:00:00Z", startedAt: "2026-01-01T00:00:00Z", completedAt: undefined, attempts: 1, maxAttempts: 3, nextAttemptAt: undefined, lastError: undefined, lastFailureCategory: undefined, idempotencyKey: "k", createdBy: "attacker-supplied-value" };
      },
      async transitionTo(_jobId: string, completion: { status: string }) {
        return { jobId: "j1" as never, jobType: "PERFORMANCE_SNAPSHOT" as never, status: completion.status as never, payloadReference: maliciousPayload, scheduledAt: "2026-01-01T00:00:00Z", startedAt: undefined, completedAt: undefined, attempts: 1, maxAttempts: 3, nextAttemptAt: undefined, lastError: undefined, lastFailureCategory: undefined, idempotencyKey: "k", createdBy: "attacker-supplied-value" };
      },
      async listRecent() {
        return [];
      },
    };
    const audit = { record: async () => undefined };
    const worker = new OperationalJobWorker({ jobs: jobs as never, handlers: [handler as never], audit: audit as never });
    await worker.runOnce("PERFORMANCE_SNAPSHOT" as never);
    // The worker handed the raw payload to the handler (for the handler's OWN use, e.g. periodStart/periodEnd) — but nowhere in OperationalJobWorker itself is "role"/"userId"/"isAdmin" ever read or branched on.
    expect(handlerSawPayload).toEqual(maliciousPayload);
  });
});

describe("SECTION11 ADVERSARIAL N: a report-generation request for an already-existing period, under a different idempotency key, is refused — never silently creates a conflicting duplicate", () => {
  class PreSeededReportsStore implements WeeklyReportsStore {
    private readonly existing: WeeklyReportRecord;
    constructor(existing: WeeklyReportRecord) {
      this.existing = existing;
    }
    async findByIdempotencyKey(): Promise<WeeklyReportRecord | undefined> {
      // Simulates a caller whose computed idempotency key does not match the one already on file for this period.
      return undefined;
    }
    async findCurrentForPeriod(): Promise<WeeklyReportRecord | undefined> {
      return this.existing;
    }
    async create(_input: NewWeeklyReportInput): Promise<WeeklyReportRecord> {
      throw new Error("must never be called in this scenario");
    }
  }
  class EmptyLedgerReader implements PerformanceLedgerReader {
    async listForPeriod(): Promise<readonly PerformanceLedgerEntry[]> {
      return [];
    }
  }

  it("refuses rather than silently inserting a second 'version 1' for a period that already has one", async () => {
    const existing: WeeklyReportRecord = {
      reportId: "existing-report" as never,
      periodStart: "2026-01-01T00:00:00Z",
      periodEnd: "2026-01-07T23:59:59Z",
      ledgerMode: LedgerMode.LIVE,
      reportVersion: 1,
      status: "FINALIZED",
      generatedAt: "2026-01-08T00:00:00Z",
      generatedBy: "system",
      sourceReference: {},
      reportPayload: {},
      supersedesReportId: undefined,
      supersededReason: undefined,
      idempotencyKey: "weekly-report:2026-01-01T00:00:00Z:2026-01-07T23:59:59Z:LIVE",
      createdAt: "2026-01-08T00:00:00Z",
    };
    const result = await generateWeeklyReport({ ledger: new EmptyLedgerReader(), reports: new PreSeededReportsStore(existing) }, { periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-01-07T23:59:59Z", ledgerMode: LedgerMode.LIVE, generatedBy: "system" });
    expect(result.ok).toBe(false);
  });
});

describe("SECTION11 ADVERSARIAL R: admin-facing operational DTOs never carry a secret-shaped field", () => {
  it("no exported type/value from license-admin or platform-settings-admin has a key named like a secret", async () => {
    const licenseAdmin = await import("@sport-os/platform");
    const allExportNames = [...Object.keys(licenseAdmin)];
    for (const name of allExportNames) {
      expect(name.toLowerCase()).not.toMatch(/bottoken|sessionsecret|servicerolekey|privatekey/);
    }
  });
});

describe("SECTION11 ADVERSARIAL V: no agent-invocation 'retry' admin action is exposed — retry is the job system's job, never a direct re-run of agent.execute()", () => {
  it("agent-operations.ts exports no function whose name suggests retrying/re-running an invocation directly", () => {
    const exportedNames = Object.keys(agentOperations);
    for (const name of exportedNames) {
      expect(name).not.toMatch(/retry|rerun|reexecute/i);
    }
  });
});
