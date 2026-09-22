import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  bindMiniAppCssVars,
  bindThemeParamsCssVars,
  bindViewportCssVars,
  closeMiniApp,
  expandViewport,
  init,
  isTMA,
  isViewportExpanded,
  mountBackButton,
  mountMainButton,
  mountMiniAppSync,
  mountThemeParamsSync,
  mountViewport,
  miniAppReady,
  retrieveRawInitData,
  themeParamsBackgroundColor,
  viewportHeight,
  viewportStableHeight,
} from "@telegram-apps/sdk";
import { parseUnsafeTelegramUser, type UnsafeTelegramUser } from "./parseUnsafeUser.js";
import { useSignal } from "./useSignal.js";

export interface TelegramContextValue {
  /** False outside Telegram (e.g. a plain browser during local development). */
  readonly isRunningInTelegram: boolean;
  /** True once SDK initialization/mounting has settled — gate rendering on this, not just isRunningInTelegram. */
  readonly isReady: boolean;
  /** Raw, still-signed initData. Send to the backend as-is; never parse it for trusted identity. */
  readonly rawInitData: string | undefined;
  /** initDataUnsafe, for display/context ONLY — never authentication (see parseUnsafeUser.ts). */
  readonly unsafeUser: UnsafeTelegramUser | undefined;
  readonly colorScheme: "light" | "dark";
  readonly viewportHeight: number;
  readonly viewportStableHeight: number;
  readonly isViewportExpanded: boolean;
  readonly expand: () => void;
  readonly close: () => void;
}

const TelegramContext = createContext<TelegramContextValue | undefined>(undefined);

function isDarkColor(hex: string | undefined): boolean {
  if (!hex) return true;
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  // Perceived brightness (ITU-R BT.601).
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

export function TelegramProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const initialized = useRef(false);
  const [isRunningInTelegram] = useState(() => (typeof window !== "undefined" ? isTMA() : false));
  const [isReady, setIsReady] = useState(!isRunningInTelegram);
  const [rawInitData, setRawInitData] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!isRunningInTelegram || initialized.current) return;
    initialized.current = true;

    let cleanupSdk: (() => void) | undefined;

    /**
     * Each Telegram bridge call is isolated: one unsupported/failing
     * component (e.g. an older client without Main Button support) must
     * never cascade into skipping ready()/back-button/haptics setup for
     * everything mounted after it.
     */
    const attempt = (fn: () => void): void => {
      try {
        fn();
      } catch {
        // Unsupported in this Telegram client version — safe to skip.
      }
    };

    void (async () => {
      try {
        cleanupSdk = init();
      } catch {
        setIsReady(true);
        return;
      }

      try {
        setRawInitData(retrieveRawInitData());
      } catch {
        setRawInitData(undefined);
      }

      attempt(() => mountThemeParamsSync.isAvailable() && mountThemeParamsSync());
      attempt(() => mountMiniAppSync.isAvailable() && mountMiniAppSync());
      if (mountViewport.isAvailable()) {
        await mountViewport().catch(() => undefined);
      }
      attempt(() => mountBackButton.isAvailable() && mountBackButton());
      attempt(() => mountMainButton.isAvailable() && mountMainButton());

      attempt(() => bindThemeParamsCssVars.isAvailable() && bindThemeParamsCssVars());
      attempt(() => bindMiniAppCssVars.isAvailable() && bindMiniAppCssVars());
      attempt(() => bindViewportCssVars.isAvailable() && bindViewportCssVars());
      // Tells theme/tokens.css to stop guessing from prefers-color-scheme
      // and trust the live Telegram --tg-theme-* variables instead.
      document.documentElement.setAttribute("data-tg-theme-bound", "true");

      attempt(() => miniAppReady.isAvailable() && miniAppReady());

      setIsReady(true);
    })();

    return () => {
      cleanupSdk?.();
    };
  }, [isRunningInTelegram]);

  const themeBg = useSignal(themeParamsBackgroundColor);
  const currentViewportHeight = useSignal(viewportHeight);
  const currentViewportStableHeight = useSignal(viewportStableHeight);
  const currentIsViewportExpanded = useSignal(isViewportExpanded);

  const value: TelegramContextValue = {
    isRunningInTelegram,
    isReady,
    rawInitData,
    unsafeUser: parseUnsafeTelegramUser(rawInitData),
    colorScheme: isDarkColor(themeBg) ? "dark" : "light",
    viewportHeight: currentViewportHeight || (typeof window !== "undefined" ? window.innerHeight : 0),
    viewportStableHeight: currentViewportStableHeight || (typeof window !== "undefined" ? window.innerHeight : 0),
    isViewportExpanded: currentIsViewportExpanded,
    expand: () => {
      if (expandViewport.isAvailable()) expandViewport();
    },
    close: () => {
      if (closeMiniApp.isAvailable()) closeMiniApp();
    },
  };

  return <TelegramContext.Provider value={value}>{children}</TelegramContext.Provider>;
}

export function useTelegram(): TelegramContextValue {
  const context = useContext(TelegramContext);
  if (!context) {
    throw new Error("useTelegram() must be used within a <TelegramProvider>.");
  }
  return context;
}
