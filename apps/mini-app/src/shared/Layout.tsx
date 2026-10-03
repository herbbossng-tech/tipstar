import type { ReactNode } from "react";
import { clientConfig } from "../config.js";
import { useTelegramTheme } from "../telegram/useTelegramTheme.js";
import { IdentityBadge } from "./IdentityBadge.js";
import { NavBar } from "./NavBar.js";

export function Layout({ children }: { readonly children: ReactNode }): JSX.Element {
  useTelegramTheme();

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-header__title">{clientConfig.appName}</span>
        <IdentityBadge />
      </header>
      <main className="app-content">{children}</main>
      <NavBar />
    </div>
  );
}
