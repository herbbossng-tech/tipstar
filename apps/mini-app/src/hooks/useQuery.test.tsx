// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `useQuery.ts` imports `ApiError` from `../services/api.js`, which reads
 * `clientConfig` at module load time (real, required client config — see
 * `.env.example`) — not available by default under a plain `vitest run`.
 * Each test stubs the two required vars and re-imports fresh via a
 * dynamic `import()` (never a static top-level one, which would be
 * hoisted ahead of the stub and fail the same way) — see
 * `services/api.test.ts`'s own comment for the full explanation.
 */
async function importModules(): Promise<{ useQuery: typeof import("./useQuery.js").useQuery; ApiError: typeof import("../services/api.js").ApiError }> {
  vi.stubEnv("VITE_APP_NAME", "Sport Intelligence OS");
  vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8787");
  vi.resetModules();
  const [{ useQuery }, { ApiError }] = await Promise.all([import("./useQuery.js"), import("../services/api.js")]);
  return { useQuery, ApiError };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("useQuery — race-condition protection (Section 09 §32)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("starts in loading state and transitions to success with the real data", async () => {
    const { useQuery } = await importModules();
    const { result } = renderHook(() => useQuery(() => Promise.resolve({ value: 42 }), []));
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current).toMatchObject({ status: "success", data: { value: 42 } });
  });

  it("discards a stale response when deps change before the first call resolves — never overwrites fresher state with an older result", async () => {
    const { useQuery } = await importModules();
    const first = deferred<{ value: string }>();
    const second = deferred<{ value: string }>();
    let callCount = 0;

    const { result, rerender } = renderHook(({ dep }: { dep: number }) => useQuery(() => (++callCount === 1 ? first.promise : second.promise), [dep]), { initialProps: { dep: 1 } });

    rerender({ dep: 2 }); // fires the second call before the first has resolved
    second.resolve({ value: "second" });
    await waitFor(() => expect(result.current.status).toBe("success"));
    first.resolve({ value: "first" }); // resolves AFTER — must never clobber the second, fresher result
    await new Promise((r) => setTimeout(r, 10));

    expect(result.current).toMatchObject({ status: "success", data: { value: "second" } });
  });

  it("maps a typed ApiError into {code, message} — never an unhandled rejection reaching the component", async () => {
    const { useQuery, ApiError } = await importModules();
    const { result } = renderHook(() => useQuery(() => Promise.reject(new ApiError("FEATURE_NOT_ENTITLED", "Not included in your plan.")), []));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current).toMatchObject({ status: "error", code: "FEATURE_NOT_ENTITLED", message: "Not included in your plan." });
  });

  it("refetch() re-runs the fetcher", async () => {
    const { useQuery } = await importModules();
    const fetcher = vi.fn().mockResolvedValue({ value: 1 });
    const { result } = renderHook(() => useQuery(fetcher, []));
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(fetcher).toHaveBeenCalledOnce();

    result.current.refetch();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });
});
