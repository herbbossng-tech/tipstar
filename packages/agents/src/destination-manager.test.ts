import { InMemoryAuditService, Role, UserStatus, type AuthorizationContext } from "@sport-os/platform";
import { err, IntegrationError, ok } from "@sport-os/shared";
import { TelegramDestinationType, TelegramDestinationVerificationStatus, type SendMessageResult, type TelegramDestination, type TelegramDestinationManager, type TelegramService } from "@sport-os/telegram";
import { describe, expect, it } from "vitest";
import { createDestination, disableDestination, listDestinations, updateDestinationSettings, verifyDestination, type DestinationManagerDependencies } from "./destination-manager.js";

class InMemoryDestinationManager implements TelegramDestinationManager {
  private readonly rows = new Map<string, TelegramDestination>();
  private nextId = 1;

  async list() {
    return [...this.rows.values()];
  }
  async get(destinationId: string) {
    return this.rows.get(destinationId);
  }
  async create(destination: Omit<TelegramDestination, "destinationId" | "createdAt">, _createdBy: string): Promise<TelegramDestination> {
    const created: TelegramDestination = { ...destination, destinationId: `d${this.nextId++}`, createdAt: new Date().toISOString() };
    this.rows.set(created.destinationId, created);
    return created;
  }
  async update(destinationId: string, patch: Partial<Omit<TelegramDestination, "destinationId" | "createdAt">>): Promise<TelegramDestination> {
    const existing = this.rows.get(destinationId);
    if (!existing) throw new Error("not found");
    const updated = { ...existing, ...patch };
    this.rows.set(destinationId, updated);
    return updated;
  }
}

function stubTelegram(reachable: boolean): TelegramService {
  return {
    sendMessage: async () => ok<SendMessageResult>({ messageId: 1 }),
    replyToMessage: async () => ok<SendMessageResult>({ messageId: 1 }),
    getChat: async () => (reachable ? ok({ id: 1, type: "channel" as const, title: "Main" }) : err(new IntegrationError({ message: "chat not found" }))),
    getChatMember: async () => err(new IntegrationError({ message: "not used" })),
  };
}

const admin: AuthorizationContext = { userId: "admin-1", role: Role.ADMIN, status: UserStatus.ACTIVE };
const owner: AuthorizationContext = { userId: "owner-1", role: Role.OWNER, status: UserStatus.ACTIVE };
const ordinaryUser: AuthorizationContext = { userId: "user-1", role: Role.USER, status: UserStatus.ACTIVE };

function buildDeps(reachable = true): DestinationManagerDependencies {
  return { destinations: new InMemoryDestinationManager(), telegram: stubTelegram(reachable), audit: new InMemoryAuditService() };
}

const newDestinationInput = {
  telegramChatId: "-1001",
  name: "Main Channel",
  type: TelegramDestinationType.CHANNEL,
  enabled: true,
  autoPublish: true,
  publishBookingCode: false,
  publishTicket: true,
  publishResults: false,
  publishWeeklyReport: false,
};

describe("destination-manager — Section 10 §9/§10/§28/§29 (OWNER/ADMIN only, never a client write)", () => {
  it("TEST A: an ordinary USER cannot create a destination", async () => {
    const result = await createDestination(buildDeps(), ordinaryUser, newDestinationInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("administrative authority");
  });

  it("TEST B: an ADMIN can create a destination, which starts UNVERIFIED — never VERIFIED by default", async () => {
    const result = await createDestination(buildDeps(), admin, newDestinationInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.verificationStatus).toBe(TelegramDestinationVerificationStatus.UNVERIFIED);
      expect(result.value.verifiedAt).toBeUndefined();
    }
  });

  it("TEST C: an OWNER can also create a destination (OWNER implies admin authority)", async () => {
    const result = await createDestination(buildDeps(), owner, newDestinationInput);
    expect(result.ok).toBe(true);
  });

  it("TEST D: verifyDestination marks a reachable chat VERIFIED with a real verifiedAt timestamp", async () => {
    const deps = buildDeps(true);
    const created = await createDestination(deps, admin, newDestinationInput);
    if (!created.ok) throw new Error("setup failed");
    const result = await verifyDestination(deps, admin, created.value.destinationId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.verificationStatus).toBe(TelegramDestinationVerificationStatus.VERIFIED);
      expect(result.value.verifiedAt).toBeDefined();
    }
  });

  it("TEST E: verifyDestination marks an unreachable chat FAILED — never pretends success", async () => {
    const deps = buildDeps(false);
    const created = await createDestination(deps, admin, newDestinationInput);
    if (!created.ok) throw new Error("setup failed");
    const result = await verifyDestination(deps, admin, created.value.destinationId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.verificationStatus).toBe(TelegramDestinationVerificationStatus.FAILED);
      expect(result.value.verifiedAt).toBeUndefined();
    }
  });

  it("TEST F: an ordinary USER cannot verify a destination", async () => {
    const deps = buildDeps();
    const created = await createDestination(deps, admin, newDestinationInput);
    if (!created.ok) throw new Error("setup failed");
    const result = await verifyDestination(deps, ordinaryUser, created.value.destinationId);
    expect(result.ok).toBe(false);
  });

  it("TEST G: updateDestinationSettings can change publish flags but the type system has no way to pass telegramChatId/type/verificationStatus through it", async () => {
    const deps = buildDeps();
    const created = await createDestination(deps, admin, newDestinationInput);
    if (!created.ok) throw new Error("setup failed");
    const result = await updateDestinationSettings(deps, admin, created.value.destinationId, { publishResults: true, name: "Renamed Channel" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.publishResults).toBe(true);
      expect(result.value.name).toBe("Renamed Channel");
      // Identity fields are completely untouched by this call.
      expect(result.value.telegramChatId).toBe("-1001");
      expect(result.value.type).toBe(TelegramDestinationType.CHANNEL);
    }
  });

  it("TEST H: an ordinary USER cannot update destination settings", async () => {
    const deps = buildDeps();
    const created = await createDestination(deps, admin, newDestinationInput);
    if (!created.ok) throw new Error("setup failed");
    const result = await updateDestinationSettings(deps, ordinaryUser, created.value.destinationId, { enabled: false });
    expect(result.ok).toBe(false);
  });

  it("TEST I: disableDestination sets enabled=false and is admin-gated", async () => {
    const deps = buildDeps();
    const created = await createDestination(deps, admin, newDestinationInput);
    if (!created.ok) throw new Error("setup failed");
    const deniedForUser = await disableDestination(deps, ordinaryUser, created.value.destinationId);
    expect(deniedForUser.ok).toBe(false);
    const result = await disableDestination(deps, admin, created.value.destinationId);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.enabled).toBe(false);
  });

  it("TEST J: listDestinations is admin-gated — an ordinary USER gets a denial, never the destination list", async () => {
    const deps = buildDeps();
    await createDestination(deps, admin, newDestinationInput);
    const denied = await listDestinations(deps, ordinaryUser);
    expect(denied.ok).toBe(false);
    const allowed = await listDestinations(deps, admin);
    expect(allowed.ok).toBe(true);
    if (allowed.ok) expect(allowed.value).toHaveLength(1);
  });

  it("TEST K: every destination mutation is audited with the acting user as actor", async () => {
    const audit = new InMemoryAuditService();
    const deps: DestinationManagerDependencies = { destinations: new InMemoryDestinationManager(), telegram: stubTelegram(true), audit };
    const created = await createDestination(deps, admin, newDestinationInput);
    if (!created.ok) throw new Error("setup failed");
    await verifyDestination(deps, admin, created.value.destinationId);
    await disableDestination(deps, admin, created.value.destinationId);
    const actions = audit.getEvents().map((e) => e.action);
    expect(actions).toEqual(["destination_created", "destination_verified", "destination_disabled"]);
    expect(audit.getEvents().every((e) => e.actor === admin.userId)).toBe(true);
  });
});
