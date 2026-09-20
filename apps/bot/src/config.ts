import { loadServerConfig } from "@tipstar/config";
import { TipstarError, ErrorCodes } from "@tipstar/shared";

export function loadBotConfig() {
  const config = loadServerConfig();
  if (!config.telegram.botToken) {
    throw new TipstarError({
      code: ErrorCodes.CONFIG_INVALID,
      message: "TELEGRAM_BOT_TOKEN is required to run the bot.",
    });
  }
  return config;
}
