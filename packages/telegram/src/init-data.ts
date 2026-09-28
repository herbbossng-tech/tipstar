import { createHmac, timingSafeEqual } from "node:crypto";
import { AuthenticationError, err, ok, type Result } from "@sport-os/shared";
import { TelegramAuthErrorCode, type TelegramWebAppUser, type ValidatedInitData } from "./types.js";

const WEB_APP_DATA_KEY = "WebAppData";
/** Conservative default — see TELEGRAM_INIT_DATA_CLOCK_SKEW_SECONDS in docs/environment-variables.md. */
const DEFAULT_CLOCK_SKEW_SECONDS = 60;

export interface ValidateInitDataOptions {
  readonly maxAgeSeconds: number;
  readonly clockSkewSeconds?: number;
  readonly now?: Date;
}

/**
 * Validates a Telegram Mini App `initData` string server-side, per the
 * algorithm Telegram documents for Mini Apps:
 *
 *   secret_key = HMAC_SHA256(key="WebAppData", data=botToken)
 *   data_check_string = all fields except `hash`, sorted by key,
 *                        joined as "key=value" with "\n"
 *   expected_hash = HEX(HMAC_SHA256(key=secret_key, data=data_check_string))
 *
 * The request is rejected if the computed hash does not match
 * (timing-safe comparison), or if `auth_date` is outside the
 * `[-clockSkewSeconds, +maxAgeSeconds]` window around `now` (replay
 * protection + reject implausible future timestamps).
 *
 * This is the ONLY place Telegram identity may be trusted from (Section
 * 01 Security Principle 3 / Section 02 rule 5: "Telegram identity must be
 * verified server-side"). A client-supplied Telegram user id with no
 * validated initData must never be trusted.
 */
export function validateInitData(
  initDataRaw: string,
  botToken: string,
  options: ValidateInitDataOptions = { maxAgeSeconds: 86400 },
): Result<ValidatedInitData, AuthenticationError> {
  const clockSkewSeconds = options.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initDataRaw);
  } catch {
    return err(new AuthenticationError({ message: "Telegram initData could not be parsed.", code: TelegramAuthErrorCode.INIT_DATA_MALFORMED }));
  }

  const hash = params.get("hash");
  if (!hash) {
    return err(new AuthenticationError({ message: "Telegram initData is missing a hash.", code: TelegramAuthErrorCode.INIT_DATA_INVALID }));
  }

  const entries: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === "hash") continue;
    entries.push(`${key}=${value}`);
  }
  entries.sort();
  const dataCheckString = entries.join("\n");

  const secretKey = createHmac("sha256", WEB_APP_DATA_KEY).update(botToken).digest();
  const computedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  // Timing-safe comparison — an ordinary `===` would leak timing
  // information about how many leading bytes matched (Section 02 rule 10).
  const hashesMatch = computedHash.length === hash.length && timingSafeEqual(Buffer.from(computedHash, "hex"), Buffer.from(hash, "hex"));
  if (!hashesMatch) {
    return err(new AuthenticationError({ message: "Telegram initData signature is invalid.", code: TelegramAuthErrorCode.INIT_DATA_INVALID }));
  }

  const authDateRaw = params.get("auth_date");
  if (!authDateRaw) {
    return err(new AuthenticationError({ message: "Telegram initData is missing auth_date.", code: TelegramAuthErrorCode.INIT_DATA_MALFORMED }));
  }
  const authDateSeconds = Number(authDateRaw);
  if (!Number.isFinite(authDateSeconds) || authDateSeconds <= 0) {
    return err(new AuthenticationError({ message: "Telegram initData has a malformed auth_date.", code: TelegramAuthErrorCode.INIT_DATA_MALFORMED }));
  }
  const authDate = new Date(authDateSeconds * 1000);
  const now = options.now ?? new Date();
  const ageSeconds = (now.getTime() - authDate.getTime()) / 1000;
  if (ageSeconds > options.maxAgeSeconds || ageSeconds < -clockSkewSeconds) {
    return err(
      new AuthenticationError({
        message: "Telegram initData has expired.",
        code: TelegramAuthErrorCode.INIT_DATA_EXPIRED,
        context: { ageSeconds, maxAgeSeconds: options.maxAgeSeconds, clockSkewSeconds },
      }),
    );
  }

  let user: TelegramWebAppUser | undefined;
  const userRaw = params.get("user");
  if (userRaw) {
    try {
      user = JSON.parse(userRaw) as TelegramWebAppUser;
    } catch {
      return err(
        new AuthenticationError({ message: "Telegram initData user field could not be parsed.", code: TelegramAuthErrorCode.INIT_DATA_MALFORMED }),
      );
    }
  }

  return ok({ user, authDate, queryId: params.get("query_id") ?? undefined, startParam: params.get("start_param") ?? undefined });
}
