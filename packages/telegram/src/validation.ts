import { err, ok, ValidationError, type Result } from "@sport-os/shared";
import { TelegramDestinationType, type TelegramDestination } from "./types.js";

/**
 * Validates a Telegram destination record before it's persisted or used
 * to publish. This is deterministic structural validation only — it does
 * not connect to Telegram or verify the chat id actually exists (that is
 * a later-section integration concern).
 */
export function validateTelegramDestination(destination: TelegramDestination): Result<TelegramDestination, ValidationError> {
  if (!destination.destinationId) {
    return err(new ValidationError({ message: "Telegram destination is missing destinationId." }));
  }
  if (!destination.name || destination.name.trim().length === 0) {
    return err(new ValidationError({ message: "Telegram destination is missing a name.", context: { destinationId: destination.destinationId } }));
  }
  if (!destination.telegramChatId || destination.telegramChatId.trim().length === 0) {
    return err(new ValidationError({ message: "Telegram destination is missing telegramChatId.", context: { destinationId: destination.destinationId } }));
  }
  // Telegram chat ids are numeric, optionally negative (channels/supergroups use negative ids).
  if (!/^-?\d+$/.test(destination.telegramChatId)) {
    return err(
      new ValidationError({
        message: "Telegram destination's telegramChatId must be a numeric Telegram chat id.",
        context: { destinationId: destination.destinationId },
      }),
    );
  }
  if (!Object.values(TelegramDestinationType).includes(destination.type)) {
    return err(
      new ValidationError({
        message: `Telegram destination has an unrecognized type: "${destination.type}".`,
        context: { destinationId: destination.destinationId },
      }),
    );
  }
  if (!destination.enabled && destination.autoPublish) {
    return err(
      new ValidationError({
        message: "A disabled Telegram destination cannot have autoPublish enabled.",
        context: { destinationId: destination.destinationId },
      }),
    );
  }
  return ok(destination);
}
