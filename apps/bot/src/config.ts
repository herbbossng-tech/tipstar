import { loadServerConfig } from "@sport-os/config";
import { ConfigurationError } from "@sport-os/shared";

export function loadBotConfig() {
  const config = loadServerConfig();
  if (!config.telegram.botToken) {
    throw new ConfigurationError({ message: "TELEGRAM_BOT_TOKEN is required to run the bot." });
  }
  return config;
}
