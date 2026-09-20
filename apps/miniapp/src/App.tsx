import { Route, Routes } from "react-router-dom";
import { NavBar } from "./components/NavBar.js";
import { HomePage } from "./pages/HomePage.js";
import { PicksPage } from "./pages/PicksPage.js";
import { MatchesPage } from "./pages/MatchesPage.js";
import { PerformancePage } from "./pages/PerformancePage.js";
import { AccountPage } from "./pages/AccountPage.js";
import type { TelegramBootstrapResult } from "./telegram/bootstrap.js";

export interface AppProps {
  readonly telegram: TelegramBootstrapResult;
}

export function App({ telegram }: AppProps): JSX.Element {
  return (
    <div className="app-shell">
      <main className="app-content">
        <Routes>
          <Route path="/" element={<HomePage telegram={telegram} />} />
          <Route path="/picks" element={<PicksPage />} />
          <Route path="/matches" element={<MatchesPage />} />
          <Route path="/performance" element={<PerformancePage />} />
          <Route path="/account" element={<AccountPage />} />
        </Routes>
      </main>
      <NavBar />
    </div>
  );
}
