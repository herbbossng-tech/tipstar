import type { UUID } from "@tipstar/types";

export const NotificationType = {
  PICK_ALERT: "pick_alert",
  RESULT_ALERT: "result_alert",
  SUBSCRIPTION_ALERT: "subscription_alert",
  ACCOUNT_ALERT: "account_alert",
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export interface NotificationMessage {
  readonly userId: UUID;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;
  readonly data: Readonly<Record<string, string>> | undefined;
}

/** Abstracts the delivery channel (Telegram today; email/push later) behind one interface. */
export interface NotificationProvider {
  readonly providerId: string;
  send(message: NotificationMessage): Promise<void>;
}
