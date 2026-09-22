import type { NotificationPreferences, TelegramIdentity, User, UserRole } from "@tipstar/types";

/**
 * Safe, client-facing representation of the authenticated user. Never
 * includes internal-only fields (service-role data, security metadata) —
 * this is the ONLY shape `GET current user` may ever return.
 */
export interface UserProfileDTO {
  readonly id: string;
  readonly status: User["status"];
  readonly roles: readonly UserRole[];
  readonly languageCode: string | null;
  readonly createdAt: string;
  readonly lastActiveAt: string | null;
  readonly telegram: {
    readonly username: string | null;
    readonly firstName: string | null;
    readonly lastName: string | null;
    readonly isPremium: boolean | null;
  };
  readonly notificationPreferences: NotificationPreferences | null;
}

export function buildUserProfileDTO(
  user: User,
  telegramIdentity: TelegramIdentity,
  notificationPreferences: NotificationPreferences | null,
): UserProfileDTO {
  return {
    id: user.id,
    status: user.status,
    roles: user.roles,
    languageCode: user.languageCode,
    createdAt: user.createdAt,
    lastActiveAt: user.lastActiveAt,
    telegram: {
      username: telegramIdentity.telegramUsername,
      firstName: telegramIdentity.firstName,
      lastName: telegramIdentity.lastName,
      isPremium: telegramIdentity.isPremium,
    },
    notificationPreferences,
  };
}
