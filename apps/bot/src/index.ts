import { StructuredLogger } from "@sport-os/shared";
import { loadBotConfig } from "./config.js";
import { createBot } from "./bot.js";
import { buildBotContainer } from "./container.js";
import { createWebhookServer } from "./server.js";

const config = loadBotConfig();
const logger = new StructuredLogger({ environment: config.app.env, service: "bot", minSeverity: config.app.logLevel });
const container = buildBotContainer(config);
const bot = createBot(config, logger, container);

const PORT = Number(process.env.PORT ?? 8788);

if (config.telegram.webhookSecret) {
  const server = createWebhookServer(bot, config.telegram.webhookSecret, logger);
  server.listen(PORT, () => {
    logger.info("Sport Intelligence OS bot listening for webhook updates", { port: PORT });
  });
} else {
  logger.info("TELEGRAM_WEBHOOK_SECRET not set — starting in long-polling mode for local development.");
  void bot.start();
}
