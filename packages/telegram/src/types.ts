import type { ISODateString, UUID } from "@sport-os/shared";

/** Raw fields Telegram signs into Mini App initData's `user` JSON field. */
export interface TelegramWebAppUser {
  readonly id: number;
  readonly first_name: string;
  readonly last_name?: string;
  readonly username?: string;
  readonly language_code?: string;
  readonly is_premium?: boolean;
}

/** Parsed and validated Telegram Mini App initData. */
export interface ValidatedInitData {
  readonly user: TelegramWebAppUser | undefined;
  readonly authDate: Date;
  readonly queryId: string | undefined;
  readonly startParam: string | undefined;
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
