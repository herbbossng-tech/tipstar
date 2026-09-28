import { Route, Routes } from "react-router-dom";
import { AviatorPage } from "./aviator/AviatorPage.js";
import { DashboardPage } from "./dashboard/DashboardPage.js";
import { FootballPage } from "./football/FootballPage.js";
import { SettingsPage } from "./settings/SettingsPage.js";
import { AuthBoundary } from "./shared/AuthBoundary.js";
import { Layout } from "./shared/Layout.js";

export function App(): JSX.Element {
  return (
    <AuthBoundary>
      <Layout>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/football" element={<FootballPage />} />
          <Route path="/aviator" element={<AviatorPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </Layout>
    </AuthBoundary>
  );
}
