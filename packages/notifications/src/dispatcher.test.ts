import { describe, expect, it } from "vitest";
import { NotificationDispatcher, InMemoryDispatchedNotificationStore } from "./dispatcher.js";
import { MockNotificationProvider } from "./mock-provider.js";
import { NotificationType } from "./provider.js";

describe("NotificationDispatcher", () => {
  it("sends a notification once and skips a duplicate dispatch with the same key", async () => {
    const provider = new MockNotificationProvider();
    const dispatcher = new NotificationDispatcher(provider, new InMemoryDispatchedNotificationStore());
    const message = { userId: "user-1", type: NotificationType.PICK_ALERT, title: "New pick", body: "...", data: undefined };

    const first = await dispatcher.dispatch(message, "pick:pick-1:published");
    const second = await dispatcher.dispatch(message, "pick:pick-1:published");

    expect(first).toBe("sent");
    expect(second).toBe("skipped_duplicate");
    expect(provider.sentMessages).toHaveLength(1);
  });
});
