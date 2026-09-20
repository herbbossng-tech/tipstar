import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Bot } from "grammy";
import { verifyWebhookSecret } from "@tipstar/telegram";
import type { Logger } from "@tipstar/shared";

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Minimal webhook HTTP server. Every request is rejected before touching
 * the bot unless its `X-Telegram-Bot-Api-Secret-Token` header matches the
 * secret registered via setWebhook (Engineering Constitution L — validate
 * Telegram-originated requests server-side).
 */
export function createWebhookServer(bot: Bot, webhookSecret: string, logger: Logger) {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      if (req.method !== "POST" || req.url !== "/telegram/webhook") {
        res.writeHead(404).end();
        return;
      }

      if (!verifyWebhookSecret(req.headers["x-telegram-bot-api-secret-token"] as string | undefined, webhookSecret)) {
        logger.warn("Rejected webhook request with invalid secret token");
        res.writeHead(401).end();
        return;
      }

      try {
        const body = await readBody(req);
        const update = JSON.parse(body);
        await bot.handleUpdate(update);
        res.writeHead(200).end();
      } catch (error) {
        logger.error("Failed to process webhook update", { error: String(error) });
        res.writeHead(500).end();
      }
    })();
  });
}
