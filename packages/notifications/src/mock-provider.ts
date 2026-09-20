import type { NotificationMessage, NotificationProvider } from "./provider.js";

/** DEVELOPMENT-ONLY notification provider — logs instead of sending. Never wire into production. */
export class MockNotificationProvider implements NotificationProvider {
  readonly providerId = "mock";
  readonly sentMessages: NotificationMessage[] = [];

  async send(message: NotificationMessage): Promise<void> {
    this.sentMessages.push(message);
  }
}
