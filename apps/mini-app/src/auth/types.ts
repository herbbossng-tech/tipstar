/**
 * Wire contract with the `/telegram-auth` endpoint (Section 02). Defined
 * locally rather than imported from @sport-os/telegram: that package
 * pulls in node:crypto (see init-data.ts), which cannot be bundled into a
 * browser build — see packages/shared/src/id.ts's Section 01 history for
 * the same reason. Keep this in sync with
 * supabase/functions/telegram-auth/index.ts's response shape.
 */
export interface AuthenticatedIdentity {
  readonly telegramUserId: number;
  readonly firstName: string;
  readonly lastName: string | undefined;
  readonly username: string | undefined;
  readonly languageCode: string | undefined;
  readonly isPremium: boolean | undefined;
  readonly authMode: "telegram" | "dev";
}

export interface AuthSessionHandle {
  readonly token: string;
  readonly expiresAt: string;
}
