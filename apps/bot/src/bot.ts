import { Bot } from "grammy";
import type { TipstarConfig } from "@tipstar/config";
import type { Logger } from "@tipstar/shared";

/**
 * Builds the Tipstar Telegram bot (Section 19). Section 01 registers only
 * onboarding (/start, launching the Mini App) — pick alerts, result
 * alerts, and subscription messages are wired in later sections via
 * @tipstar/notifications once a NotificationProvider backs onto this bot.
 */
export function createBot(config: TipstarConfig, logger: Logger): Bot {
  if (!config.telegram.botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is required.");
  }

  const bot = new Bot(config.telegram.botToken);

  bot.command("start", async (ctx) => {
    const miniAppUrl = config.telegram.miniAppUrl;
    if (miniAppUrl) {
      await ctx.reply("Welcome to Tipstar. Open the Mini App to get started.", {
        reply_markup: {
          inline_keyboard: [[{ text: "Open Tipstar", web_app: { url: miniAppUrl } }]],
        },
      });
    } else {
      await ctx.reply("Welcome to Tipstar. The Mini App is not configured yet.");
    }
  });

  bot.catch((error) => {
    logger.error("Unhandled bot error", { error: String(error.error) });
  });

  return bot;
}
