export interface UnsafeTelegramUser {
  readonly id: number;
  readonly firstName: string;
  readonly lastName: string | undefined;
  readonly username: string | undefined;
  readonly languageCode: string | undefined;
}

/**
 * Reads the `user` field out of raw initData FOR DISPLAY/CONTEXT ONLY
 * (e.g. an optimistic greeting while authentication is in flight). This is
 * `initDataUnsafe` in spirit — it is never signature-checked here, and
 * MUST NEVER be treated as authenticated identity. Only the backend's
 * validated response (src/api/auth.ts) may be trusted as "who the user is".
 */
export function parseUnsafeTelegramUser(rawInitData: string | undefined): UnsafeTelegramUser | undefined {
  if (!rawInitData) return undefined;
  try {
    const params = new URLSearchParams(rawInitData);
    const userRaw = params.get("user");
    if (!userRaw) return undefined;
    const parsed = JSON.parse(userRaw) as {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
    return {
      id: parsed.id,
      firstName: parsed.first_name,
      lastName: parsed.last_name,
      username: parsed.username,
      languageCode: parsed.language_code,
    };
  } catch {
    return undefined;
  }
}
