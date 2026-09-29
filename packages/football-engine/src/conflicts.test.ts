import { describe, expect, it } from "vitest";
import { detectAndRecordConflict } from "./conflicts.js";
import { InMemoryDataConflictsRepository } from "./repositories/quality.js";

describe("detectAndRecordConflict", () => {
  it("records a conflict when two providers disagree on a field", async () => {
    const repo = new InMemoryDataConflictsRepository();
    const conflict = await detectAndRecordConflict(repo, { entityType: "team", entityRef: "team-uuid-1", field: "name", sourceA: "provider_a", valueA: "Test Arsenal", sourceB: "provider_b", valueB: "Arsenal Test FC" });
    expect(conflict).toBeDefined();
    expect((await repo.listUnresolved())).toHaveLength(1);
  });

  it("does not record a conflict when both providers agree", async () => {
    const repo = new InMemoryDataConflictsRepository();
    const conflict = await detectAndRecordConflict(repo, { entityType: "team", entityRef: "team-uuid-1", field: "name", sourceA: "provider_a", valueA: "Test Arsenal", sourceB: "provider_b", valueB: "Test Arsenal" });
    expect(conflict).toBeUndefined();
    expect(await repo.listUnresolved()).toHaveLength(0);
  });

  it("does not treat a field only one provider has reported as a conflict", async () => {
    const repo = new InMemoryDataConflictsRepository();
    const conflict = await detectAndRecordConflict(repo, { entityType: "team", entityRef: "team-uuid-1", field: "shortName", sourceA: "provider_a", valueA: "TAR", sourceB: "provider_b", valueB: undefined });
    expect(conflict).toBeUndefined();
  });
});
