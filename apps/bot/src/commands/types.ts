/**
 * Framework-agnostic shapes the command handlers (handlers.ts) are
 * written against — no `grammy` import here. This is the "Authenticated
 * Context" and "Response Renderer" half of the "Update -> Parser ->
 * Authenticated Context -> Authorization -> Domain Service -> Response
 * Renderer" pipeline (Section 10 §32); `bot.ts` is the "Parser" half
 * (grammy's own `ctx.command`/`ctx.match` parsing) that adapts a real
 * `grammy.Context` into these shapes and renders a `CommandReply` back
 * out, so the handlers themselves stay trivially unit-testable.
 */

/** The ONLY thing this bot ever trusts as "who sent this" — grammy's own `ctx.from`, sourced from Telegram's verified update delivery (the webhook secret token, or the long-poll connection itself), never from a command argument or callback payload (§33/§38). */
export interface TelegramCommandUser {
  readonly telegramUserId: number;
  readonly firstName: string;
  readonly lastName: string | undefined;
  readonly username: string | undefined;
  readonly languageCode: string | undefined;
  readonly isPremium: boolean;
}

export interface CommandReplyButton {
  readonly text: string;
  readonly url: string;
}

export interface CommandReply {
  readonly text: string;
  readonly buttons?: readonly CommandReplyButton[];
}
