import type { ISODateString, Maybe, UUID } from "./common.js";
import type { Sport } from "./sports.js";

export const UserStatus = {
  ACTIVE: "active",
  SUSPENDED: "suspended",
  BANNED: "banned",
  DELETED: "deleted",
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

/**
 * Least-privilege roles (Engineering Constitution section 22). Authorization
 * must be enforced server-side / via RLS — this type is the shared vocabulary,
 * not a substitute for enforcement.
 */
export const UserRole = {
  USER: "user",
  PREMIUM_USER: "premium_user",
  PARTNER_USER: "partner_user",
  MODERATOR: "moderator",
  ANALYST: "analyst",
  ADMIN: "admin",
  SUPER_ADMIN: "super_admin",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

/** Internal user identity. Telegram identity is a separate, linked record — never the primary key. */
export interface User {
  readonly id: UUID;
  readonly status: UserStatus;
  readonly roles: readonly UserRole[];
  readonly languageCode: Maybe<string>;
  readonly createdAt: ISODateString;
  readonly lastActiveAt: Maybe<ISODateString>;
}

/**
 * Telegram-supplied identity fields. These arrive from the client and MUST
 * only be trusted after server-side initData validation (see @tipstar/telegram).
 */
export interface TelegramIdentity {
  readonly userId: UUID;
  readonly telegramUserId: number;
  readonly telegramUsername: Maybe<string>;
  readonly firstName: Maybe<string>;
  readonly lastName: Maybe<string>;
  readonly isPremium: Maybe<boolean>;
  readonly linkedAt: ISODateString;
}

export interface NotificationPreferences {
  readonly userId: UUID;
  readonly pickAlerts: boolean;
  readonly resultAlerts: boolean;
  readonly subscriptionAlerts: boolean;
  readonly marketingMessages: boolean;
}

export interface UserSportPreference {
  readonly userId: UUID;
  readonly sport: Sport;
  readonly leagueId: Maybe<UUID>;
  readonly teamId: Maybe<UUID>;
}
