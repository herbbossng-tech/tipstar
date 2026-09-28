import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createTelegramWebAppClient, type TelegramWebAppClient } from "./TelegramWebAppClient.js";

const TelegramContext = createContext<TelegramWebAppClient | undefined>(undefined);

export function TelegramProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const client = useMemo(() => createTelegramWebAppClient(), []);
  return <TelegramContext.Provider value={client}>{children}</TelegramContext.Provider>;
}

export function useTelegram(): TelegramWebAppClient {
  const client = useContext(TelegramContext);
  if (!client) {
    throw new Error("useTelegram() must be used within a TelegramProvider.");
  }
  return client;
}
