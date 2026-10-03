import { useEffect } from "react";
import { useTelegram } from "./TelegramProvider.js";

const THEME_PROPERTY_MAP: ReadonlyArray<readonly [keyof TelegramWebAppThemeParams, string]> = [
  ["bg_color", "--color-bg"],
  ["secondary_bg_color", "--color-surface"],
  ["text_color", "--color-text-primary"],
  ["hint_color", "--color-text-secondary"],
  ["button_color", "--color-accent"],
];

/**
 * Applies Telegram's real theme parameters as CSS custom properties
 * (Section 09 §38 — Telegram Theme). Only ever SETS a property Telegram
 * actually supplied — `styles.css`'s own `:root`/`prefers-color-scheme`
 * defaults remain the fallback for every property Telegram didn't send,
 * so the app is never unreadable outside Telegram (§38's own rule).
 * Never throws/no-ops silently when `window.Telegram` is absent (dev
 * mode, a plain browser) — `getThemeParams()` already returns `{}` in
 * that case.
 */
export function useTelegramTheme(): void {
  const telegram = useTelegram();

  useEffect(() => {
    const root = document.documentElement;
    const colorScheme = telegram.getColorScheme();
    if (colorScheme) root.dataset.telegramColorScheme = colorScheme;

    const theme = telegram.getThemeParams();
    for (const [key, cssProperty] of THEME_PROPERTY_MAP) {
      const value = theme[key];
      if (value) root.style.setProperty(cssProperty, value);
    }
  }, [telegram]);
}
