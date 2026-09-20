/** Shape of the JSON-encoded `user` field inside Telegram initData. */
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
  readonly rawParams: ReadonlyMap<string, string>;
}
