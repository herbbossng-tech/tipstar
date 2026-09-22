import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest } from "./client.js";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("apiRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the parsed payload on a 2xx response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ user: { id: "1" } }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiRequest<{ user: { id: string } }>("telegram-me", { method: "GET" });

    expect(result.user.id).toBe("1");
  });

  it("attaches a bearer Authorization header when an access token is given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 200));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("telegram-me", { method: "GET", accessToken: "token-123" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer token-123");
  });

  it("normalizes a non-2xx response into an ApiError with a safe message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "unauthorized", reason: "session_invalid_or_expired" }, 401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("telegram-me", { method: "GET" })).rejects.toMatchObject({
      code: "session_invalid_or_expired",
      status: 401,
    });
  });

  it("never leaks a raw network error — normalizes to a safe ApiError", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed: getaddrinfo ENOTFOUND"));
    vi.stubGlobal("fetch", fetchMock);

    const caught = await apiRequest("telegram-init-auth", { method: "POST" }).catch((e: unknown) => e);

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe("network_error");
    expect((caught as ApiError).message).not.toContain("ENOTFOUND");
  });
});
