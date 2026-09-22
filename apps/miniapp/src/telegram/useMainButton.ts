import { useEffect } from "react";
import { isMainButtonMounted, onMainButtonClick, setMainButtonParams } from "@telegram-apps/sdk";
import { useSignal } from "./useSignal.js";

export interface MainButtonOptions {
  readonly text: string;
  readonly isEnabled?: boolean;
  readonly isLoaderVisible?: boolean;
}

/**
 * Reusable Telegram Main Button abstraction (Section 26). Not mounted
 * globally — a page opts in only for the flow it needs (e.g. confirming a
 * premium pick purchase in a later section), and the button is hidden and
 * its click listener removed the moment that component unmounts.
 */
export function useMainButton(options: MainButtonOptions | undefined, onClick: () => void): void {
  const isMounted = useSignal(isMainButtonMounted);

  useEffect(() => {
    if (!options || !isMounted) return undefined;

    try {
      setMainButtonParams({
        text: options.text,
        isVisible: true,
        isEnabled: options.isEnabled ?? true,
        isLoaderVisible: options.isLoaderVisible ?? false,
      });
    } catch {
      return undefined;
    }

    const off = onMainButtonClick(onClick);

    return () => {
      off();
      try {
        setMainButtonParams({ isVisible: false });
      } catch {
        // Telegram bridge already torn down — nothing to clean up.
      }
    };
  }, [isMounted, options, onClick]);
}
