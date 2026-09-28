import { describe, expect, it } from "vitest";
import { NotImplementedError } from "@sport-os/shared";
import { NotImplementedAviatorService } from "./service.js";

describe("NotImplementedAviatorService", () => {
  it("throws NotImplementedError rather than returning a fabricated signal", async () => {
    const service = new NotImplementedAviatorService();
    await expect(service.getCurrentSignal()).rejects.toThrow(NotImplementedError);
  });
});
