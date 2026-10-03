import {
  DatabaseLicenseService,
  InMemoryAuditService,
  InMemoryLicenseEntitlementsRepository,
  InMemoryLicenseLimitsRepository,
  InMemoryLicensesRepository,
  InMemoryUsersRepository,
  LicenseStatus,
  Role,
} from "@sport-os/platform";
import { err, IntegrationError, ok } from "@sport-os/shared";
import { TelegramDestinationType, type SendMessageResult, type TelegramDestination, type TelegramDestinationManager, type TelegramService } from "@sport-os/telegram";
import { describe, expect, it } from "vitest";
import { handleAccount, handleAviator, handleDestinations, handleFootball, handleHelp, handlePerformance, handleStart, handleStatus, handleVerifyDestination, type CommandDependencies } from "./handlers.js";
import type { TelegramCommandUser } from "./types.js";

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
  return { licenseService, destinations, telegram, audit, appName: "Sport Intelligence OS", miniAppUrl: undefined, ...overrides, users };
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
});
