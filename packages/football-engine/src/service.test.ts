import { describe, expect, it } from "vitest";
import { NotImplementedError } from "@sport-os/shared";
import { NotImplementedFootballService } from "./service.js";

describe("NotImplementedFootballService", () => {
  it("throws NotImplementedError rather than returning a fabricated evaluation", async () => {
    const service = new NotImplementedFootballService();
    await expect(service.evaluateEvent("event-1")).rejects.toThrow(NotImplementedError);
  });
});
