import { describe, expect, it } from "vitest";
import { verifyWebhookSecret } from "./webhook.js";

describe("verifyWebhookSecret", () => {
  it("accepts a matching secret", () => {
    expect(verifyWebhookSecret("shared-secret", "shared-secret")).toBe(true);
  });

  it("rejects a mismatched secret", () => {
    expect(verifyWebhookSecret("wrong-secret", "shared-secret")).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyWebhookSecret(undefined, "shared-secret")).toBe(false);
    expect(verifyWebhookSecret(null, "shared-secret")).toBe(false);
  });

  it("rejects an empty header", () => {
    expect(verifyWebhookSecret("", "shared-secret")).toBe(false);
  });
});
