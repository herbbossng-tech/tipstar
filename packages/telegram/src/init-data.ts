import { createHmac, timingSafeEqual } from "node:crypto";
import { ErrorCodes, TipstarError, type Result, ok, err } from "@tipstar/shared";
import type { TelegramWebAppUser, ValidatedInitData } from "./types.js";

const WEB_APP_DATA_KEY = "WebAppData";

/**
 * Validates a Telegram Mini App `initData` string server-side, per the
 * algorithm Telegram documents for Mini Apps:
 *
 *   secret_key = HMAC_SHA256(key="WebAppData", data=botToken)
 *   data_check_string = all fields except `hash`, sorted by key,
 *                        joined as "key=value" with "\n"
 *   expected_hash = HEX(HMAC_SHA256(key=secret_key, data=data_check_string))
 *
 * The request is rejected if the computed hash does not match, or if
 * `auth_date` is older than `maxAgeSeconds` (replay protection).
 *
 * This is the ONLY place Telegram user identity may be trusted from. A
 * client-supplied `telegram_user_id` with no validated initData must never
 * be trusted (Engineering Constitution, "Never trust Telegram user
 * information supplied directly by an unverified client").
 */
export function validateInitData(
  initDataRaw: string,
  botToken: string,
  options: { readonly maxAgeSeconds: number; readonly now?: Date } = { maxAgeSeconds: 86400 },
): Result<ValidatedInitData, TipstarError> {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initDataRaw);
  } catch {
    return err(
      new TipstarError({
        code: ErrorCodes.TELEGRAM_AUTH_INVALID,
        message: "Telegram initData could not be parsed.",
      }),
    );
  }

  const hash = params.get("hash");
  if (!hash) {
    return err(
      new TipstarError({
        code: ErrorCodes.TELEGRAM_AUTH_INVALID,
        message: "Telegram initData is missing a hash.",
      }),
    );
  }

  const entries: string[] = [];
  const rawParams = new Map<string, string>();
  for (const [key, value] of params.entries()) {
    rawParams.set(key, value);
    if (key === "hash") continue;
    entries.push(`${key}=${value}`);
  }
  entries.sort();
  const dataCheckString = entries.join("\n");

  const secretKey = createHmac("sha256", WEB_APP_DATA_KEY).update(botToken).digest();
  const computedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const hashesMatch =
    computedHash.length === hash.length &&
    timingSafeEqual(Buffer.from(computedHash, "hex"), Buffer.from(hash, "hex"));

  if (!hashesMatch) {
    return err(
      new TipstarError({
        code: ErrorCodes.TELEGRAM_AUTH_INVALID,
        message: "Telegram initData signature is invalid.",
      }),
    );
  }

  const authDateRaw = params.get("auth_date");
  if (!authDateRaw) {
    return err(
      new TipstarError({
        code: ErrorCodes.TELEGRAM_AUTH_INVALID,
        message: "Telegram initData is missing auth_date.",
      }),
    );
  }
  const authDate = new Date(Number(authDateRaw) * 1000);
  const now = options.now ?? new Date();
  const ageSeconds = (now.getTime() - authDate.getTime()) / 1000;
  if (ageSeconds > options.maxAgeSeconds || ageSeconds < -60) {
    return err(
      new TipstarError({
        code: ErrorCodes.TELEGRAM_AUTH_EXPIRED,
        message: "Telegram initData has expired.",
        context: { ageSeconds },
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
        new TipstarError({
          code: ErrorCodes.TELEGRAM_AUTH_INVALID,
          message: "Telegram initData user field could not be parsed.",
        }),
      );
    }
  }

  return ok({
    user,
    authDate,
    queryId: params.get("query_id") ?? undefined,
    startParam: params.get("start_param") ?? undefined,
    rawParams,
  });
}
