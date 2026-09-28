import { clientConfig } from "../config.js";

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Normalized API error. `code` is a machine-readable reason, safe to
 * branch on in the UI; `message` is always safe to show a user — raw
 * server/stack details never surface here.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number | undefined;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export interface ApiRequestOptions {
  readonly method?: "GET" | "POST" | "PUT" | "DELETE";
  readonly body?: unknown;
  readonly timeoutMs?: number;
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Centralized fetch wrapper (Section 01 — Frontend Foundation, API/
 * Service Layer). No component constructs a raw fetch()/URL itself. No
 * real backend routes exist yet — every call currently reaches an
 * unimplemented endpoint and surfaces a clear, typed error rather than
 * silently returning fabricated data.
 */
export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${clientConfig.apiBaseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: { "content-type": "application/json", ...options.headers },
      body: options.body !== undefined ? JSON.stringify(options.body) : null,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("timeout", "The request took too long. Please try again.");
    }
    throw new ApiError("network_error", "Could not reach the server. Check your connection and try again.");
  } finally {
    clearTimeout(timeout);
  }

  let payload: unknown;
  try {
    payload = response.status === 204 ? undefined : await response.json();
  } catch {
    throw new ApiError("invalid_response", "The server returned an unexpected response.", response.status);
  }

  if (!response.ok) {
    // Every Supabase Edge Function in this repo (telegram-auth, me,
    // owner-bootstrap, health) responds with { error: { code, message } }
    // on failure — match that shape exactly rather than a flat one.
    const errorPayload = payload as { error?: { code?: string; message?: string } } | undefined;
    throw new ApiError(errorPayload?.error?.code ?? "request_failed", errorPayload?.error?.message ?? "Something went wrong. Please try again.", response.status);
  }

  return payload as T;
}
