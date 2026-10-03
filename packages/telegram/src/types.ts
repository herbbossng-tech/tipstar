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
  /** Added Section 10 — Telegram's own distinct chat type for groups that have been upgraded past the legacy 200-member "basic group" limit. A real, different Bot API chat type from GROUP (different permission/admin semantics), never conflated with it. Additive to the Section 01 enum — CHANNEL/GROUP/PRIVATE keep their original values unchanged. */
  SUPERGROUP: "supergroup",
  PRIVATE: "private",
} as const;
export type TelegramDestinationType = (typeof TelegramDestinationType)[keyof typeof TelegramDestinationType];

/**
 * Whether this codebase has actually confirmed (via the Bot API) that its
 * bot can reach a destination (Section 10 §10). A destination is never
 * marked VERIFIED just because a chat id was typed in — "store an
 * explicit unverified/incomplete state rather than pretending success."
 */
export const TelegramDestinationVerificationStatus = {
  UNVERIFIED: "unverified",
  VERIFIED: "verified",
  FAILED: "failed",
} as const;
export type TelegramDestinationVerificationStatus = (typeof TelegramDestinationVerificationStatus)[keyof typeof TelegramDestinationVerificationStatus];

/**
 * A configured Telegram publishing destination (Section 01 — Telegram
 * Foundation; verification fields added Section 10). Never hard-code a
 * specific chat id anywhere outside a concrete TelegramDestination
 * record — every destination is config/database driven.
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
  /** Optional so existing Section 01/06 callers/tests that construct a `TelegramDestination` literal without it remain valid (§10 is additive) — a destination with no explicit status is treated as UNVERIFIED by every Section 10 check, never as VERIFIED by omission. */
  readonly verificationStatus?: TelegramDestinationVerificationStatus;
  readonly verifiedAt?: ISODateString | undefined;
  /** Section 11 addition — the admin user id that created this destination, for per-user usage reporting (`license-admin.ts`'s `inspectUserForAdmin`). Optional for the same additive reason as `verificationStatus` above. */
  readonly createdBy?: string;
}

/** The kinds of content the Publishing Policy Engine decides whether to publish. Additive Section 10 value: PICK (an individual pick card, distinct from a full TICKET — see §16). */
export const PublishableContentType = {
  BOOKING_CODE: "booking_code",
  TICKET: "ticket",
  PICK: "pick",
  RESULTS: "results",
  WEEKLY_REPORT: "weekly_report",
} as const;
export type PublishableContentType = (typeof PublishableContentType)[keyof typeof PublishableContentType];

// ============================================================
// Section 10 — Publishing persistence, policy, and error types
// ============================================================

/**
 * Real Telegram API failure categories (§27). Drives retry behavior —
 * only TRANSIENT is ever retried automatically; everything else is a
 * terminal outcome for that attempt. Derived from the Bot API's own
 * HTTP status + `error_code`/`description` fields, never guessed from
 * message text alone where a real code is available.
 */
export const TelegramApiErrorCategory = {
  TRANSIENT: "TRANSIENT",
  PERMANENT: "PERMANENT",
  AUTHORIZATION: "AUTHORIZATION",
  RATE_LIMITED: "RATE_LIMITED",
  NOT_FOUND: "NOT_FOUND",
  BOT_PERMISSION: "BOT_PERMISSION",
  INVALID_PAYLOAD: "INVALID_PAYLOAD",
  UNKNOWN: "UNKNOWN",
} as const;
export type TelegramApiErrorCategory = (typeof TelegramApiErrorCategory)[keyof typeof TelegramApiErrorCategory];

/**
 * Durable publication record lifecycle (§21/§30). Deliberately FOUR
 * states, not the full textbook queue lifecycle (PENDING/QUEUED/
 * PUBLISHING/RETRYING/PUBLISHED/FAILED/CANCELLED) — publishing in this
 * codebase is synchronous per destination (see TELEGRAM_PUBLISHING_
 * ARCHITECTURE.md's "Why no job queue"), so QUEUED/PUBLISHING/CANCELLED
 * have no distinct real state to occupy: a policy REJECT never creates a
 * row at all (it is an audited decision, not a publication attempt —
 * see PUBLISHING_POLICY.md), and an attempt is either still pending,
 * succeeded, permanently failed, or currently mid-retry.
 */
export const TelegramPublicationStatus = {
  PENDING: "PENDING",
  RETRYING: "RETRYING",
  PUBLISHED: "PUBLISHED",
  FAILED: "FAILED",
} as const;
export type TelegramPublicationStatus = (typeof TelegramPublicationStatus)[keyof typeof TelegramPublicationStatus];

/**
 * The source object a publication renders FROM (§50/§51) — a reference,
 * never a duplicate of the authoritative record's own fields. Additive,
 * closed set; extend here only.
 */
export const PublicationSourceType = {
  TICKET: "TICKET",
  PICK: "PICK",
  SETTLEMENT: "SETTLEMENT",
  PERFORMANCE: "PERFORMANCE",
} as const;
export type PublicationSourceType = (typeof PublicationSourceType)[keyof typeof PublicationSourceType];

/**
 * Typed publication input contract (§50). A reference-only request —
 * `sourceId`/`sourceVersion` name the authoritative record (a real
 * `tickets.id`+`version`, a real `settlements.id`, etc.); this type
 * never carries a copy of that record's own domain fields (probability,
 * odds, stake, ...). `idempotencyKey` is mandatory, mirroring
 * `AgentMessage`'s own "required on every COMMAND" rule (agent-core
 * §20) — publication is always a COMMAND.
 */
export interface PublicationRequest {
  readonly sourceType: PublicationSourceType;
  readonly sourceId: string;
  readonly sourceVersion: number;
  readonly publicationType: PublishableContentType;
  readonly destinationId: UUID;
  readonly requestedBy: string;
  readonly policyVersion: string;
  readonly idempotencyKey: string;
  /** Set only for a RESULTS publication that must reply to the original ticket message (§22) — the `telegram_message_id` of that original message, read from this same destination's own prior PUBLISHED ticket/pick record, never guessed. */
  readonly replyToTelegramMessageId?: number;
}
