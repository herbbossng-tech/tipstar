import { generateId } from "@sport-os/shared";
import { describe, expect, it } from "vitest";
import { InMemoryFixtureExternalIdentitiesRepository } from "./fixture-identities.js";

describe("InMemoryFixtureExternalIdentitiesRepository", () => {
  it("resolve() returns undefined when no mapping has been recorded", async () => {
    const repo = new InMemoryFixtureExternalIdentitiesRepository();
    await expect(repo.resolve("the-odds-api", "evt_123")).resolves.toBeUndefined();
  });

  it("recordMapping() then resolve() returns the mapped fixture id", async () => {
    const repo = new InMemoryFixtureExternalIdentitiesRepository();
    const fixtureId = generateId();
    await repo.recordMapping({ fixtureId, provider: "the-odds-api", providerFixtureId: "evt_123", matchMethod: "team_name_kickoff_time" });
    await expect(repo.resolve("the-odds-api", "evt_123")).resolves.toBe(fixtureId);
  });

  it("recordMapping() is idempotent: a repeat call for the same (provider, providerFixtureId) returns the original mapping, never a second row or an overwritten fixtureId", async () => {
    const repo = new InMemoryFixtureExternalIdentitiesRepository();
    const originalFixtureId = generateId();
    const first = await repo.recordMapping({ fixtureId: originalFixtureId, provider: "the-odds-api", providerFixtureId: "evt_123", matchMethod: "team_name_kickoff_time" });

    // Even if a later (buggy or adversarial) call supplies a DIFFERENT
    // fixtureId for the same provider identity, the original mapping must
    // win — never a silent identity change.
    const second = await repo.recordMapping({ fixtureId: generateId(), provider: "the-odds-api", providerFixtureId: "evt_123", matchMethod: "team_name_kickoff_time" });

    expect(second.id).toBe(first.id);
    expect(second.fixtureId).toBe(originalFixtureId);
    await expect(repo.resolve("the-odds-api", "evt_123")).resolves.toBe(originalFixtureId);
  });

  it("mappings are scoped per-provider: the same providerFixtureId string under a different provider never resolves to the wrong fixture", async () => {
    const repo = new InMemoryFixtureExternalIdentitiesRepository();
    const fixtureA = generateId();
    const fixtureB = generateId();
    await repo.recordMapping({ fixtureId: fixtureA, provider: "the-odds-api", providerFixtureId: "same-id", matchMethod: "team_name_kickoff_time" });
    await repo.recordMapping({ fixtureId: fixtureB, provider: "some-other-provider", providerFixtureId: "same-id", matchMethod: "team_name_kickoff_time" });

    await expect(repo.resolve("the-odds-api", "same-id")).resolves.toBe(fixtureA);
    await expect(repo.resolve("some-other-provider", "same-id")).resolves.toBe(fixtureB);
  });
});
