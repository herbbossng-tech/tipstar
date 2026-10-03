import { InMemoryInvocationsRepository } from "@sport-os/agent-core";
import {
  DatabaseLicenseService,
  InMemoryAuditService,
  InMemoryLicenseEntitlementsRepository,
  InMemoryLicenseLimitsRepository,
  InMemoryLicensesRepository,
  InMemoryUsersRepository,
  LicenseStatus,
  NotImplementedOperationalJobsRepository,
  Role,
} from "@sport-os/platform";
import { err, IntegrationError, ok } from "@sport-os/shared";
import { TelegramDestinationType, type SendMessageResult, type TelegramDestination, type TelegramDestinationManager, type TelegramService } from "@sport-os/telegram";
import { describe, expect, it } from "vitest";
import { handleAccount, handleAdmin, handleAdminAgents, handleAdminJobs, handleAdminReports, handleAviator, handleDestinations, handleFootball, handleHelp, handlePerformance, handleStart, handleStatus, handleVerifyDestination, type CommandDependencies, type WeeklyReportsListing } from "./handlers.js";
import type { TelegramCommandUser } from "./types.js";

class StubWeeklyReportsListing implements WeeklyReportsListing {
  constructor(private readonly reports: never[] = []) {}
  async listRecent() {
    return this.reports;
  }
}

function user(overrides: Partial<TelegramCommandUser> = {}): TelegramCommandUser {
  return { telegramUserId: 42, firstName: "Ada", lastName: undefined, username: "ada", languageCode: "en", isPremium: false, ...overrides };
}

class StubDestinationManager implements TelegramDestinationManager {
  destinations: TelegramDestination[] = [];
  async list() {
    return this.destinations;
  }
  async get(destinationId: string) {
    return this.destinations.find((d) => d.destinationId === destinationId);
  }
  async create(destination: Omit<TelegramDestination, "destinationId" | "createdAt">, _createdBy: string): Promise<TelegramDestination> {
    const created: TelegramDestination = { ...destination, destinationId: `d-${this.destinations.length + 1}`, createdAt: new Date().toISOString() };
    this.destinations.push(created);
    return created;
  }
  async update(destinationId: string, patch: Partial<Omit<TelegramDestination, "destinationId" | "createdAt">>): Promise<TelegramDestination> {
    const index = this.destinations.findIndex((d) => d.destinationId === destinationId);
    const updated = { ...this.destinations[index]!, ...patch };
    this.destinations[index] = updated;
    return updated;
  }
}

function stubTelegram(chatIsReachable: boolean): TelegramService {
  return {
    sendMessage: async () => ok<SendMessageResult>({ messageId: 1 }),
    replyToMessage: async () => ok<SendMessageResult>({ messageId: 1 }),
    getChat: async () => (chatIsReachable ? ok({ id: 1, type: "channel", title: "Main" }) : err(new IntegrationError({ message: "chat not found", code: "NOT_FOUND" }))),
    getChatMember: async () => err(new IntegrationError({ message: "not used" })),
  };
}

function buildDeps(overrides: Partial<Omit<CommandDependencies, "users">> = {}): CommandDependencies & { readonly users: InMemoryUsersRepository } {
  const users = new InMemoryUsersRepository();
  const licenseService = new DatabaseLicenseService(new InMemoryLicensesRepository(), new InMemoryLicenseEntitlementsRepository(), new InMemoryLicenseLimitsRepository());
  const destinations = new StubDestinationManager();
  const telegram = stubTelegram(true);
  const audit = new InMemoryAuditService();
  const operationalJobs = new NotImplementedOperationalJobsRepository();
  const weeklyReports = new StubWeeklyReportsListing();
  const agentInvocations = new InMemoryInvocationsRepository();
  return { licenseService, destinations, telegram, audit, appName: "Sport Intelligence OS", miniAppUrl: undefined, operationalJobs, weeklyReports, agentInvocations, ...overrides, users };
}

/** Seeds an ADMIN-role user under the given Telegram id so `identify()` (called first thing by every handler) resolves a real admin `AppUser` — never a role claimed by the test's own `TelegramCommandUser` input, which carries no role field at all (Section 11 §G/§W: a role is never forged via the caller's own claimed identity). */
async function seedAdmin(users: InMemoryUsersRepository, telegramUserId: number): Promise<void> {
  const seeded = await users.upsertFromTelegram({ telegramUserId, username: "admin", firstName: "Admin", lastName: undefined, languageCode: "en", isPremium: false, authenticatedAt: new Date().toISOString() });
  await users.updateRole(seeded.id, Role.ADMIN);
}

describe("bot command handlers", () => {
  it("/start onboards the Telegram user and welcomes them by app name", async () => {
    const deps = buildDeps();
    const reply = await handleStart(deps, user());
    expect(reply.text).toContain("Sport Intelligence OS");
    const stored = await deps.users.findByTelegramUserId(42);
    expect(stored?.firstName).toBe("Ada");
  });

  it("/help lists the real commands, nothing fabricated", async () => {
    const reply = await handleHelp();
    expect(reply.text).toContain("/status");
    expect(reply.text).toContain("/destinations");
  });

  it("/status reports 'no license on file' honestly rather than fabricating one", async () => {
    const deps = buildDeps();
    const reply = await handleStatus(deps, user());
    expect(reply.text).toBe("No license is on file for your account. Contact an administrator.");
  });

  it("/status reports the real license status once one exists", async () => {
    const deps = buildDeps();
    const stored = await deps.users.upsertFromTelegram({ telegramUserId: 42, username: "ada", firstName: "Ada", lastName: undefined, languageCode: "en", isPremium: false, authenticatedAt: new Date().toISOString() });
    const licenses = new InMemoryLicensesRepository();
    const licenseService = new DatabaseLicenseService(licenses, new InMemoryLicenseEntitlementsRepository(), new InMemoryLicenseLimitsRepository());
    await licenses.insert({ userId: stored.id, licenseKey: "key-1", plan: "pro", status: LicenseStatus.ACTIVE, startsAt: new Date().toISOString(), expiresAt: null, maxDevices: 1, createdBy: stored.id });
    const reply = await handleStatus({ ...deps, licenseService }, user());
    expect(reply.text).toContain(`License status: ${LicenseStatus.ACTIVE}`);
    expect(reply.text).toContain("Role: user");
  });

  it("/account adds an 'Open Mini App' button only when a Mini App URL is configured", async () => {
    const withUrl = buildDeps({ miniAppUrl: "https://mini-app.example.com" });
    const withoutUrl = buildDeps({ miniAppUrl: undefined });
    const replyWithUrl = await handleAccount(withUrl, user());
    const replyWithoutUrl = await handleAccount(withoutUrl, user());
    expect(replyWithUrl.buttons?.[0]?.url).toBe("https://mini-app.example.com");
    expect(replyWithoutUrl.buttons).toBeUndefined();
  });

  it("/football never fabricates football data — it only ever points at the Mini App or says so is unavailable", async () => {
    const deps = buildDeps({ miniAppUrl: "https://mini-app.example.com/football" });
    const reply = await handleFootball(deps, user());
    expect(reply.text).not.toMatch(/odds|probability|%/i);
    expect(reply.buttons?.[0]?.url).toBe("https://mini-app.example.com/football");
  });

  it("/performance omits any button rather than guessing a URL when none is configured", async () => {
    const deps = buildDeps({ miniAppUrl: undefined });
    const reply = await handlePerformance(deps, user());
    expect(reply.buttons).toBeUndefined();
    expect(reply.text).toContain("Mini App");
  });

  it("/aviator is always honest about unavailability — never a fabricated signal", async () => {
    const deps = buildDeps();
    const reply = await handleAviator(deps, user());
    expect(reply.text).toContain("not yet available");
  });

  it("/destinations refuses a non-admin user with a safe, factual message — no destination data leaks", async () => {
    const deps = buildDeps();
    (deps.destinations as StubDestinationManager).destinations.push({
      destinationId: "d1",
      telegramChatId: "-1001",
      name: "Main Channel",
      type: TelegramDestinationType.CHANNEL,
      enabled: true,
      autoPublish: true,
      publishBookingCode: false,
      publishTicket: true,
      publishResults: false,
      publishWeeklyReport: false,
      createdAt: new Date().toISOString(),
    });
    const reply = await handleDestinations(deps, user());
    expect(reply.text).toBe("This action requires administrative authority.");
    expect(reply.text).not.toContain("Main Channel");
  });

  it("/destinations lists real configured destinations for an admin", async () => {
    const deps = buildDeps();
    const stored = await deps.users.upsertFromTelegram({ telegramUserId: 42, username: "ada", firstName: "Ada", lastName: undefined, languageCode: "en", isPremium: false, authenticatedAt: new Date().toISOString() });
    await deps.users.updateRole(stored.id, Role.ADMIN);
    (deps.destinations as StubDestinationManager).destinations.push({
      destinationId: "d1",
      telegramChatId: "-1001",
      name: "Main Channel",
      type: TelegramDestinationType.CHANNEL,
      enabled: true,
      autoPublish: true,
      publishBookingCode: false,
      publishTicket: true,
      publishResults: false,
      publishWeeklyReport: false,
      createdAt: new Date().toISOString(),
    });
    const reply = await handleDestinations(deps, user());
    expect(reply.text).toContain("Main Channel");
  });

  it("/verifydestination requires an argument", async () => {
    const deps = buildDeps();
    const reply = await handleVerifyDestination(deps, user(), undefined);
    expect(reply.text).toBe("Usage: /verifydestination <destination_id>");
  });

  it("/verifydestination marks the destination FAILED (not fake-VERIFIED) when the bot cannot reach the chat", async () => {
    const deps = buildDeps({ telegram: stubTelegram(false) });
    const stored = await deps.users.upsertFromTelegram({ telegramUserId: 42, username: "ada", firstName: "Ada", lastName: undefined, languageCode: "en", isPremium: false, authenticatedAt: new Date().toISOString() });
    await deps.users.updateRole(stored.id, Role.ADMIN);
    const created = await (deps.destinations as StubDestinationManager).create(
      { telegramChatId: "-1001", name: "Main Channel", type: TelegramDestinationType.CHANNEL, enabled: true, autoPublish: true, publishBookingCode: false, publishTicket: true, publishResults: false, publishWeeklyReport: false },
      stored.id,
    );
    const reply = await handleVerifyDestination(deps, user(), created.destinationId);
    expect(reply.text).toContain("failed");
  });

  describe("Section 11 admin commands — authorization is resolved from the real stored user, never the caller's claimed identity", () => {
    it("/admin denies a plain USER", async () => {
      const deps = buildDeps();
      const reply = await handleAdmin(deps, user());
      expect(reply.text).toContain("administrative authority");
    });

    it("/admin shows the menu to a real ADMIN user", async () => {
      const deps = buildDeps();
      await seedAdmin(deps.users, 42);
      const reply = await handleAdmin(deps, user());
      expect(reply.text).toContain("/adminjobs");
    });

    it("/adminjobs denies a plain USER", async () => {
      const deps = buildDeps();
      const reply = await handleAdminJobs(deps, user());
      expect(reply.text).toContain("administrative authority");
    });

    it("/adminjobs lists real queued/failed jobs for an admin, never a fabricated summary", async () => {
      const now = new Date().toISOString();
      const job = { jobId: "j1", jobType: "PERFORMANCE_SNAPSHOT", status: "FAILED", payloadReference: {}, scheduledAt: now, startedAt: now, completedAt: undefined, attempts: 3, maxAttempts: 3, nextAttemptAt: undefined, lastError: "boom", lastFailureCategory: "TIMEOUT", idempotencyKey: "k1", createdBy: "system", createdAt: now, updatedAt: now } as never;
      const operationalJobs = new NotImplementedOperationalJobsRepository();
      operationalJobs.listRecent = async () => [job];
      const deps = buildDeps({ operationalJobs });
      await seedAdmin(deps.users, 42);
      const reply = await handleAdminJobs(deps, user());
      expect(reply.text).toContain("PERFORMANCE_SNAPSHOT");
      expect(reply.text).toContain("FAILED");
      expect(reply.text).toContain("boom");
    });

    it("/adminjobs reports an honest empty state rather than fabricating activity", async () => {
      const operationalJobs = new NotImplementedOperationalJobsRepository();
      operationalJobs.listRecent = async () => [];
      const deps = buildDeps({ operationalJobs });
      await seedAdmin(deps.users, 42);
      const reply = await handleAdminJobs(deps, user());
      expect(reply.text).toBe("No operational jobs recorded yet.");
    });

    it("/adminreports denies a plain USER", async () => {
      const deps = buildDeps();
      const reply = await handleAdminReports(deps, user());
      expect(reply.text).toContain("administrative authority");
    });

    it("/adminreports lists real report versions for an admin", async () => {
      const report = { reportId: "r1", periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-01-07T23:59:59Z", ledgerMode: "LIVE", reportVersion: 1, status: "FINALIZED", generatedAt: "2026-01-08T00:00:00Z", generatedBy: "system", sourceReference: {}, reportPayload: {}, supersedesReportId: undefined, supersededReason: undefined, idempotencyKey: "k1", createdAt: "2026-01-08T00:00:00Z" };
      const deps = buildDeps({ weeklyReports: new StubWeeklyReportsListing([report as never]) });
      await seedAdmin(deps.users, 42);
      const reply = await handleAdminReports(deps, user());
      expect(reply.text).toContain("LIVE");
      expect(reply.text).toContain("v1");
    });

    it("/adminagents denies a plain USER (via the real getAgentOperationsSummary authorization check)", async () => {
      const deps = buildDeps();
      const reply = await handleAdminAgents(deps, user());
      expect(reply.text).toContain("administrative authority");
    });

    it("/adminagents reports real zero counts rather than fabricating activity when nothing has run yet", async () => {
      const deps = buildDeps();
      await seedAdmin(deps.users, 42);
      const reply = await handleAdminAgents(deps, user());
      expect(reply.text).toContain("Invocations inspected: 0");
    });
  });
});
