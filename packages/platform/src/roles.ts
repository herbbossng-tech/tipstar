import type { ISODateString, UUID } from "@sport-os/shared";
import { Role } from "./license.js";

export const UserStatus = {
  ACTIVE: "active",
  SUSPENDED: "suspended",
  DISABLED: "disabled",
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

/**
 * Application-level user record (Section 03 — Core Identity Model).
 * `role` and `status` are separate axes on purpose — see
 * docs/architecture/AUTHORIZATION.md: a user may be ACTIVE with an
 * EXPIRED license, or SUSPENDED with an otherwise-ACTIVE license. Never
 * collapse the two.
 */
export interface AppUser {
  readonly id: UUID;
  readonly telegramUserId: number;
  readonly username: string | undefined;
  readonly firstName: string;
  readonly lastName: string | undefined;
  readonly languageCode: string | undefined;
  readonly isPremium: boolean;
  readonly role: Role;
  readonly status: UserStatus;
  readonly lastAuthenticatedAt: ISODateString | undefined;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
}

/**
 * The already-resolved, already-authenticated identity of whoever is
 * calling an admin operation — resolved from their verified session
 * BEFORE any function in this file is invoked (see
 * upsertAuthenticatedTelegramUser() / DatabaseIdentityService). Nothing
 * in this module re-verifies Telegram identity; that is Section 02's job
 * and happens strictly earlier in the request path.
 */
export interface AuthorizationContext {
  readonly userId: UUID;
  readonly role: Role;
  readonly status: UserStatus;
}

export function isOwner(context: AuthorizationContext): boolean {
  return context.role === Role.OWNER;
}

/** True for OWNER as well as ADMIN — an owner also holds administrative authority. */
export function isAdmin(context: AuthorizationContext): boolean {
  return context.role === Role.OWNER || context.role === Role.ADMIN;
}

export function isActiveUser(context: AuthorizationContext): boolean {
  return context.status === UserStatus.ACTIVE;
}
