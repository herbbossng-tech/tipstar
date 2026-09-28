import type { ISODateString, UUID } from "@sport-os/shared";

/**
 * Raw fields Telegram signs into Mini App initData's `user` JSON field.
 * Kept to exactly the fields this system uses (Section 02: "do not add
 * unsupported fields just because they seem useful") — Telegram's own
 * payload may carry more; anything unused here is simply not modeled.
 */
export interface TelegramWebAppUser {
  readonly id: number;
  readonly first_name: string;
  readonly last_name?: string;
  readonly username?: string;
  readonly language_code?: string;
  readonly is_premium?: boolean;
  readonly photo_url?: string;
}

/** Parsed and validated Telegram Mini App initData. */
export interface ValidatedInitData {
  readonly user: TelegramWebAppUser | undefined;
  readonly authDate: Date;
  readonly queryId: string | undefined;
  readonly startParam: string | undefined;
}

/**
 * Fine-grained authentication error codes (Section 02). Carried on
 * `AppError.code` alongside the broader `kind` (always
 * `authentication_error` or `validation_error` for these) — see
 * docs/architecture/TELEGRAM_AUTHENTICATION.md.
 */
export const TelegramAuthErrorCode = {
  INIT_DATA_MISSING: "TELEGRAM_INIT_DATA_MISSING",
  INIT_DATA_INVALID: "TELEGRAM_INIT_DATA_INVALID",
  INIT_DATA_EXPIRED: "TELEGRAM_INIT_DATA_EXPIRED",
  INIT_DATA_MALFORMED: "TELEGRAM_INIT_DATA_MALFORMED",
  AUTH_NOT_CONFIGURED: "TELEGRAM_AUTH_NOT_CONFIGURED",
  USER_MISSING: "TELEGRAM_USER_MISSING",
} as const;
export type TelegramAuthErrorCode = (typeof TelegramAuthErrorCode)[keyof typeof TelegramAuthErrorCode];

/**
 * The output of a successful Telegram authentication (Section 02). This
 * is NOT a persisted internal user — `@sport-os/platform`'s `Identity`
 * (Section 03+) is what that becomes once `IdentityService` has real
 * persistence. `telegramUserId` here comes ONLY from
 * cryptographically verified initData — never accept this shape
 * constructed from client-supplied fields as authentication proof.
 */
export interface AuthenticatedTelegramIdentity {
  readonly telegramUserId: number;
  readonly firstName: string;
  readonly lastName: string | undefined;
  readonly username: string | undefined;
  readonly languageCode: string | undefined;
  readonly isPremium: boolean | undefined;
  /** From the verified initData's own auth_date field. */
  readonly authDate: ISODateString;
  /** When this server verified it — distinct from authDate (when Telegram signed it). */
  readonly verifiedAt: ISODateString;
  /** "telegram" for a real verified login, "dev" for the isolated development bypass — see docs/architecture/TELEGRAM_AUTHENTICATION.md. Never "dev" outside explicit, non-production configuration. */
  readonly authMode: "telegram" | "dev";
}

export const TelegramDestinationType = {
  CHANNEL: "channel",
  GROUP: "group",
  PRIVATE: "private",
} as const;
export type TelegramDestinationType = (typeof TelegramDestinationType)[keyof typeof TelegramDestinationType];

/**
 * A configured Telegram publishing destination (Section 01 — Telegram
 * Foundation). Never hard-code a specific chat id anywhere outside a
 * concrete TelegramDestination record — every destination is
 * config/database driven.
 */
export interface TelegramDestination {
  readonly destinationId: UUID;
  readonly telegramChatId: string;
  readonly name: string;
  readonly type: TelegramDestinationType;
  readonly enabled: boolean;
  readonly autoPublish: boolean;
  readonly publishBookingCode: boolean;
  readonly publishTicket: boolean;
  readonly publishResults: boolean;
  readonly publishWeeklyReport: boolean;
  readonly createdAt: ISODateString;
}

/** The kinds of content the Publishing Policy Engine decides whether to publish. */
export const PublishableContentType = {
  BOOKING_CODE: "booking_code",
  TICKET: "ticket",
  RESULTS: "results",
  WEEKLY_REPORT: "weekly_report",
} as const;
export type PublishableContentType = (typeof PublishableContentType)[keyof typeof PublishableContentType];
