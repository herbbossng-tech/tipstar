import { edgeFunctionsBaseUrl } from "../config.js";

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Normalized API error. `code` is a machine-readable reason (an edge
 * function's `error`/`reason` field, or a transport-level code such as
 * `network_error` / `timeout`) — safe to branch on in the UI. `message` is
 * always safe to show a user; raw server/stack details never surface here.
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
  readonly method?: "GET" | "POST";
  readonly body?: unknown;
  readonly accessToken?: string;
  readonly timeoutMs?: number;
}

/**
 * Centralized fetch wrapper for every Tipstar Edge Function call. Callers
 * never construct raw fetch()/URLs themselves — this is the one place base
 * URL, auth headers, JSON parsing, timeouts, and error normalization live.
 */
export async function apiRequest<T>(functionName: string, options: ApiRequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${edgeFunctionsBaseUrl}/${functionName}`, {
      method: options.method ?? "GET",
      headers: {
        "content-type": "application/json",
        ...(options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : null,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("timeout", "Tipstar is taking longer than expected to respond. Please try again.");
    }
    throw new ApiError("network_error", "Could not reach Tipstar. Check your connection and try again.");
  } finally {
    clearTimeout(timeout);
  }

  let payload: unknown;
  try {
    payload = response.status === 204 ? undefined : await response.json();
  } catch {
    throw new ApiError("invalid_response", "Tipstar returned an unexpected response. Please try again.", response.status);
  }

  if (!response.ok) {
    const errorPayload = payload as { error?: string; reason?: string } | undefined;
    const code = errorPayload?.reason ?? errorPayload?.error ?? "request_failed";
    throw new ApiError(code, describeErrorCode(code), response.status);
  }

  return payload as T;
}

/** Maps machine-readable error codes to safe, user-facing copy. Never echoes server internals. */
function describeErrorCode(code: string): string {
  switch (code) {
    case "missing_init_data":
      return "Tipstar couldn't find your Telegram session. Please reopen the app from Telegram.";
    case "signature_invalid":
      return "Your Telegram session could not be verified. Please reopen the app from Telegram.";
    case "expired":
      return "Your Telegram session has expired. Please reopen the app from Telegram.";
    case "missing_user":
    case "malformed_user":
      return "Telegram did not provide your account details. Please try again.";
    case "session_invalid_or_expired":
    case "session_not_found":
      return "Your session has expired. Please reopen Tipstar.";
    case "missing_session":
      return "You're not signed in yet.";
    case "user_provisioning_failed":
      return "Tipstar couldn't set up your account right now. Please try again shortly.";
    case "server_misconfigured":
      return "Tipstar is temporarily unavailable. Please try again shortly.";
    case "timeout":
    case "network_error":
      return "Could not reach Tipstar. Check your connection and try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}
