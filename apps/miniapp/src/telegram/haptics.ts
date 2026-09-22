import { hapticFeedbackImpactOccurred, hapticFeedbackNotificationOccurred, hapticFeedbackSelectionChanged, isHapticFeedbackSupported } from "@telegram-apps/sdk";

/**
 * Small reusable haptic abstraction (Section 27). Use sparingly — only for
 * a genuine confirmation/selection moment, never decoratively on every tap.
 * Silently no-ops outside Telegram or on unsupported clients.
 */
export const haptics = {
  impact(style: "light" | "medium" | "heavy" | "rigid" | "soft" = "medium"): void {
    if (!isHapticFeedbackSupported()) return;
    try {
      hapticFeedbackImpactOccurred(style);
    } catch {
      // Unsupported in this Telegram client version — safe to ignore.
    }
  },
  notification(type: "error" | "success" | "warning"): void {
    if (!isHapticFeedbackSupported()) return;
    try {
      hapticFeedbackNotificationOccurred(type);
    } catch {
      // Unsupported in this Telegram client version — safe to ignore.
    }
  },
  selection(): void {
    if (!isHapticFeedbackSupported()) return;
    try {
      hapticFeedbackSelectionChanged();
    } catch {
      // Unsupported in this Telegram client version — safe to ignore.
    }
  },
};
