import { Bot } from "grammy";
import type { AppConfig } from "@sport-os/config";
import type { Logger } from "@sport-os/shared";

/**
 * Builds the Sport Intelligence OS Telegram bot (Section 01 — Telegram
 * Foundation). Only registers a generic onboarding /start handler — no
 * channel is hard-coded, no automated publishing exists yet (that
 * requires the Publishing Policy Engine + a persisted destination
 * catalog, both later-section concerns).
 */
export function createBot(config: AppConfig, logger: Logger): Bot {
  if (!config.telegram.botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is required.");
  }

  const bot = new Bot(config.telegram.botToken);

  bot.command("start", async (ctx) => {
    await ctx.reply(`Welcome to ${config.app.name}. This bot is running its Section 01 foundation build.`);
  });

  bot.catch((error) => {
    logger.error("Unhandled bot error", { error: String(error.error) });
  });

  return bot;
}
