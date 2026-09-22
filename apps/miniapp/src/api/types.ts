/**
 * Client-side mirror of @tipstar/session's UserProfileDTO. Kept as a plain
 * local type (rather than importing the Node package) so the Mini App
 * bundle never depends on a server-only package graph — see Section 36
 * (bundle size) and Section 8 (never return more than a safe DTO).
 */
export interface UserProfileDTO {
  readonly id: string;
  readonly status: "active" | "suspended" | "banned" | "deleted";
  readonly roles: readonly string[];
  readonly languageCode: string | null;
  readonly createdAt: string;
  readonly lastActiveAt: string | null;
  readonly telegram: {
    readonly username: string | null;
    readonly firstName: string | null;
    readonly lastName: string | null;
    readonly isPremium: boolean | null;
  };
  readonly notificationPreferences: {
    readonly pick_alerts: boolean;
    readonly result_alerts: boolean;
    readonly subscription_alerts: boolean;
    readonly marketing_messages: boolean;
  } | null;
}

export interface IssuedSession {
  readonly accessToken: string;
  readonly tokenType: "bearer";
  readonly expiresAt: string;
}

export interface TelegramAuthResponse {
  readonly user: UserProfileDTO;
  readonly session: IssuedSession;
  readonly authMode: "telegram" | "dev_bypass";
}

export interface CurrentUserResponse {
  readonly user: UserProfileDTO;
}
