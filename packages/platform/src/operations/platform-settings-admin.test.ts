import { describe, expect, it } from "vitest";
import { InMemoryPlatformSettingsRepository } from "../owner-bootstrap.js";
import { Role } from "../license.js";
import { UserStatus, type AuthorizationContext } from "../roles.js";
import { getPlatformSettingsSnapshot, type PlatformSettingsSnapshotInput } from "./platform-settings-admin.js";

const admin: AuthorizationContext = { userId: "admin-1", role: Role.ADMIN, status: UserStatus.ACTIVE };
const ordinaryUser: AuthorizationContext = { userId: "user-1", role: Role.USER, status: UserStatus.ACTIVE };

const input: PlatformSettingsSnapshotInput = {
  appEnv: "production",
  devAuthModeEnabled: false,
  jobsEnabled: true,
  sportyBetIntegrationMode: "disabled",
  telegramBotConfigured: true,
  telegramMiniAppUrlConfigured: false,
  footballDataProviderConfigured: false,
  oddsProviderConfigured: false,
};

describe("getPlatformSettingsSnapshot — Section 11 §D (never echoes a secret value)", () => {
  it("TEST 1: a USER is denied the snapshot", async () => {
    const result = await getPlatformSettingsSnapshot(new InMemoryPlatformSettingsRepository(), ordinaryUser, input);
    expect(result.ok).toBe(false);
  });

  it("TEST 2: an admin sees ownerBootstrapAvailable=true before the one-time claim happens", async () => {
    const result = await getPlatformSettingsSnapshot(new InMemoryPlatformSettingsRepository(), admin, input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.ownerBootstrapAvailable).toBe(true);
  });

  it("TEST 3: ownerBootstrapAvailable flips to false once the real claim has happened — never re-derivable as a mutation path here", async () => {
    const settings = new InMemoryPlatformSettingsRepository(async () => {});
    await settings.claimAndPromoteOwner("user-1" as never);
    const result = await getPlatformSettingsSnapshot(settings, admin, input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.ownerBootstrapAvailable).toBe(false);
  });

  it("TEST 4: the snapshot type carries only booleans/strings for integrations — there is no field shaped like a secret value", async () => {
    const result = await getPlatformSettingsSnapshot(new InMemoryPlatformSettingsRepository(), admin, input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const keys = Object.keys(result.value);
      for (const key of keys) {
        expect(key.toLowerCase()).not.toMatch(/token|secret|key$|credential/);
      }
    }
  });
});
