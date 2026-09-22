import { useSyncExternalStore } from "react";

/** Minimal structural type matching @telegram-apps/signals' Signal/Computed. */
export interface ReadableSignal<T> {
  (): T;
  sub(fn: (current: T, previous: T) => void): () => void;
}

/**
 * Subscribes a React component to a @telegram-apps/sdk signal (they're all
 * built on @telegram-apps/signals) via useSyncExternalStore, so Telegram
 * theme/viewport/button state changes re-render exactly the components
 * that read them — no bespoke event wiring per component.
 */
export function useSignal<T>(signal: ReadableSignal<T>): T {
  return useSyncExternalStore(
    (onChange) => signal.sub(onChange),
    () => signal(),
    () => signal(),
  );
}
