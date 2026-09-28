import { AuthenticationError, ConfigurationError, err, ok, type AppError, type Result } from "@sport-os/shared";
import { validateInitData } from "./init-data.js";
import { TelegramAuthErrorCode, type AuthenticatedTelegramIdentity } from "./types.js";

export interface TelegramAuthenticationServiceOptions {
  /** Server-only. Never logged, never returned in any result. */
  readonly botToken: string | undefined;
  readonly maxAgeSeconds: number;
  readonly clockSkewSeconds: number;
}

/**
 * TelegramAuthenticationService (Section 02). Responsibilities: validate
 * raw initData, return a verified identity, reject invalid/expired
 * authentication, never leak validation internals. It does NOT create
 * persistent users, licenses, or entitlements — see
 * docs/architecture/TELEGRAM_AUTHENTICATION.md and Section 01's
 * IdentityService/LicenseService (`@sport-os/platform`), which own that
 * once Section 03 adds persistence.
 *
 * Deliberately framework/transport-agnostic (no HTTP concepts) so it's
 * testable on its own — see authentication-service.test.ts — independent
 * of the Supabase Edge Function that calls it
 * (supabase/functions/telegram-auth).
 */
export interface TelegramAuthenticationService {
  authenticate(rawInitData: string): Promise<Result<AuthenticatedTelegramIdentity, AppError>>;
}

export class DefaultTelegramAuthenticationService implements TelegramAuthenticationService {
  private readonly options: TelegramAuthenticationServiceOptions;

  constructor(options: TelegramAuthenticationServiceOptions) {
    this.options = options;
  }

  async authenticate(rawInitData: string): Promise<Result<AuthenticatedTelegramIdentity, AppError>> {
    if (!this.options.botToken) {
      // Never log/return *why* in more detail than this — no secret state to leak here anyway.
      return err(new ConfigurationError({ message: "Telegram authentication is not configured.", code: TelegramAuthErrorCode.AUTH_NOT_CONFIGURED }));
    }

    if (!rawInitData || rawInitData.trim().length === 0) {
      return err(new AuthenticationError({ message: "Telegram initData was not provided.", code: TelegramAuthErrorCode.INIT_DATA_MISSING }));
    }

    const validated = validateInitData(rawInitData, this.options.botToken, {
      maxAgeSeconds: this.options.maxAgeSeconds,
      clockSkewSeconds: this.options.clockSkewSeconds,
    });
    if (!validated.ok) {
      return err(validated.error);
    }

    const { user, authDate } = validated.value;
    if (!user) {
      return err(new AuthenticationError({ message: "Telegram initData did not include a user.", code: TelegramAuthErrorCode.USER_MISSING }));
    }

    const identity: AuthenticatedTelegramIdentity = {
      telegramUserId: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      username: user.username,
      languageCode: user.language_code,
      isPremium: user.is_premium,
      authDate: authDate.toISOString(),
      verifiedAt: new Date().toISOString(),
      authMode: "telegram",
    };
    return ok(identity);
  }
}
