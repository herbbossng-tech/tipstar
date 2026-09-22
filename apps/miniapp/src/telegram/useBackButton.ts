import { useEffect } from "react";
import { hideBackButton, isBackButtonSupported, onBackButtonClick, showBackButton } from "@telegram-apps/sdk";

/**
 * Reusable Telegram Back Button abstraction (Section 25). Shows the Back
 * Button for as long as the calling component is mounted and `enabled` is
 * true, wires `onClick`, and tears everything down on unmount/route change
 * — no stale Telegram event handlers survive a navigation.
 */
export function useBackButton(onClick: () => void, enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled || !isBackButtonSupported()) return undefined;

    let offClick: (() => void) | undefined;
    try {
      showBackButton();
      offClick = onBackButtonClick(onClick);
    } catch {
      return undefined;
    }

    return () => {
      try {
        offClick?.();
        hideBackButton();
      } catch {
        // Telegram bridge already torn down (e.g. app closing) — nothing to clean up.
      }
    };
  }, [onClick, enabled]);
}
