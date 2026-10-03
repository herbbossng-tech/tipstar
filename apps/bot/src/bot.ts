import { Bot, InlineKeyboard, type Context } from "grammy";
import type { AppConfig } from "@sport-os/config";
import type { Logger } from "@sport-os/shared";
import {
  handleAccount,
  handleAdmin,
  handleAdminAgents,
  handleAdminJobs,
  handleAdminReports,
  handleAviator,
  handleDestinations,
  handleFootball,
  handleHelp,
  handlePerformance,
  handleStart,
  handleStatus,
  handleTickets,
  handleVerifyDestination,
  type CommandDependencies,
} from "./commands/handlers.js";
import type { CommandReply, TelegramCommandUser } from "./commands/types.js";

/**
 * Builds the Sport Intelligence OS Telegram bot (Section 01 foundation;
 * real command routing added Section 10). "Update -> Parser ->
 * Authenticated Context -> Authorization -> Domain Service -> Response
 * Renderer" (§32) — this file is the Parser + Response Renderer; every
 * command handler it calls (`commands/handlers.ts`) is the
 * framework-agnostic Authenticated Context + Authorization + Domain
 * Service, independently unit-testable without `grammy` at all.
 */

function toCommandUser(ctx: Context): TelegramCommandUser | undefined {
  const from = ctx.from;
  if (!from) return undefined;
  return {
    telegramUserId: from.id,
    firstName: from.first_name,
    lastName: from.last_name,
    username: from.username,
    languageCode: from.language_code,
    isPremium: from.is_premium ?? false,
  };
}

async function renderReply(ctx: Context, reply: CommandReply): Promise<void> {
  if (!reply.buttons || reply.buttons.length === 0) {
    await ctx.reply(reply.text);
    return;
  }
  const keyboard = reply.buttons.reduce((kb, button) => kb.url(button.text, button.url), new InlineKeyboard());
  await ctx.reply(reply.text, { reply_markup: keyboard });
}

/** Wraps a handler so an unidentified update (no `ctx.from` — should not happen for a real command update, but never assumed) gets a safe, factual reply rather than a thrown error. */
function withIdentifiedUser(handler: (deps: CommandDependencies, from: TelegramCommandUser, ctx: Context) => Promise<CommandReply>, deps: CommandDependencies) {
  return async (ctx: Context) => {
    const from = toCommandUser(ctx);
    if (!from) {
      await ctx.reply("This command requires a Telegram user context.");
      return;
    }
    const reply = await handler(deps, from, ctx);
    await renderReply(ctx, reply);
  };
}

export function createBot(config: AppConfig, logger: Logger, deps: CommandDependencies): Bot {
  if (!config.telegram.botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is required.");
  }

  const bot = new Bot(config.telegram.botToken);

  bot.command("start", withIdentifiedUser((d, from) => handleStart(d, from), deps));
  bot.command("help", async (ctx) => renderReply(ctx, await handleHelp()));
  bot.command("status", withIdentifiedUser((d, from) => handleStatus(d, from), deps));
  bot.command("account", withIdentifiedUser((d, from) => handleAccount(d, from), deps));
  bot.command("football", withIdentifiedUser((d, from) => handleFootball(d, from), deps));
  bot.command("tickets", withIdentifiedUser((d, from) => handleTickets(d, from), deps));
  bot.command("performance", withIdentifiedUser((d, from) => handlePerformance(d, from), deps));
  bot.command("aviator", withIdentifiedUser((d, from) => handleAviator(d, from), deps));
  bot.command("destinations", withIdentifiedUser((d, from) => handleDestinations(d, from), deps));
  bot.command(
    "verifydestination",
    withIdentifiedUser((d, from, ctx) => handleVerifyDestination(d, from, ctx.match?.toString().trim() || undefined), deps),
  );
  bot.command("admin", withIdentifiedUser((d, from) => handleAdmin(d, from), deps));
  bot.command("adminjobs", withIdentifiedUser((d, from) => handleAdminJobs(d, from), deps));
  bot.command("adminreports", withIdentifiedUser((d, from) => handleAdminReports(d, from), deps));
  bot.command("adminagents", withIdentifiedUser((d, from) => handleAdminAgents(d, from), deps));

  bot.catch((error) => {
    logger.error("Unhandled bot error", { error: String(error.error) });
  });

  return bot;
}
