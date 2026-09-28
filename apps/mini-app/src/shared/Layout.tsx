import type { ReactNode } from "react";
import { clientConfig } from "../config.js";
import { NavBar } from "./NavBar.js";

export function Layout({ children }: { readonly children: ReactNode }): JSX.Element {
  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-header__title">{clientConfig.appName}</span>
      </header>
      <main className="app-content">{children}</main>
      <NavBar />
    </div>
  );
}
