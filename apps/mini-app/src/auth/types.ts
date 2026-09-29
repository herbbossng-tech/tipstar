/**
 * Wire contract with the `/telegram-auth` endpoint (Section 02; `role`/
 * `status` added additively in Section 03). Defined locally rather than
 * imported from @sport-os/telegram: that package pulls in node:crypto
 * (see init-data.ts), which cannot be bundled into a browser build — see
 * packages/shared/src/id.ts's Section 01 history for the same reason.
 * Keep this in sync with supabase/functions/telegram-auth/index.ts's
 * response shape.
 */
export interface AuthenticatedIdentity {
  readonly telegramUserId: number;
  readonly firstName: string;
  readonly lastName: string | undefined;
  readonly username: string | undefined;
  readonly languageCode: string | undefined;
  readonly isPremium: boolean | undefined;
  readonly authMode: "telegram" | "dev";
  readonly role: "owner" | "admin" | "user";
  readonly status: "active" | "suspended" | "disabled";
}

export interface AuthSessionHandle {
  readonly token: string;
  readonly expiresAt: string;
}

/**
 * Wire contract with the `/me` endpoint (Section 03). `license` is null
 * when the user has no active/trial license — never fabricated. Never
 * carries a raw license key.
 */
export interface UserProfile {
  readonly identity: AuthenticatedIdentity;
  readonly license: {
    readonly plan: string;
    readonly status: "trial" | "active" | "suspended" | "expired" | "revoked";
    readonly startsAt: string;
    readonly expiresAt: string | null;
    readonly isActive: boolean;
  } | null;
  readonly entitlements: readonly string[];
}
