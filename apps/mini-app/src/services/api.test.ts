import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiError as ApiErrorType } from "./api.js";

/**
 * `services/api.ts` reads `clientConfig` (`../config.js`) at module load
 * time, which throws if `VITE_APP_NAME`/`VITE_API_BASE_URL` aren't set —
 * real, required client config (see `.env.example`), not available by
 * default under a plain `vitest run` from the repo root. Each test below
 * stubs those two vars and re-imports the module fresh
 * (`vi.resetModules()` + a dynamic `import()`, never a static top-level
 * one) so the stub is in place before `config.ts` evaluates — a static
 * import would be hoisted ahead of the stub and fail the same way.
 */
async function importApiModule(): Promise<typeof import("./api.js")> {
  vi.stubEnv("VITE_APP_NAME", "Sport Intelligence OS");
  vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8787");
  vi.resetModules();
  return import("./api.js");
}

describe("buildQueryString", () => {
  it("drops undefined and empty-string values — never sends ?foo=undefined", async () => {
    const { buildQueryString } = await importApiModule();
    expect(buildQueryString({ a: "1", b: undefined, c: "" })).toBe("?a=1");
  });

  it("returns an empty string when nothing is set", async () => {
    const { buildQueryString } = await importApiModule();
    expect(buildQueryString({ a: undefined })).toBe("");
  });
});

describe("apiRequest / authedGet", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("normalizes a server error envelope into a typed ApiError, never a raw exception shape", async () => {
    const { apiRequest } = await importApiModule();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, json: () => Promise.resolve({ error: { code: "FEATURE_NOT_ENTITLED", message: "This feature is not included in your plan." } }) }));

    await expect(apiRequest("/tickets")).rejects.toMatchObject({ code: "FEATURE_NOT_ENTITLED", status: 403 });
  });

  it("never throws a raw network error — normalizes to a typed, user-safe ApiError", async () => {
    const { apiRequest, ApiError } = await importApiModule();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    let error: ApiErrorType | undefined;
    try {
      await apiRequest("/tickets");
    } catch (e) {
      error = e as ApiErrorType;
    }
    expect(error).toBeInstanceOf(ApiError);
    expect(error?.code).toBe("network_error");
  });

  it("authedGet attaches the bearer token and real query params, never a raw fetch call from the caller's own code", async () => {
    const { authedGet } = await importApiModule();
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ tickets: [] }) });
    vi.stubGlobal("fetch", fetchSpy);

    await authedGet("/tickets", "real-session-token", { status: "EXECUTED" });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/tickets?status=EXECUTED");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer real-session-token");
  });
});
