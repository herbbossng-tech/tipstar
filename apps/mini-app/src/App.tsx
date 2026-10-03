import { Route, Routes } from "react-router-dom";
import { AccountPage } from "./account/AccountPage.js";
import { AdminHome } from "./admin/AdminHome.js";
import { AdminJobsPage } from "./admin/AdminJobsPage.js";
import { AdminReportsPage } from "./admin/AdminReportsPage.js";
import { AviatorPage } from "./aviator/AviatorPage.js";
import { FixtureDetailPage } from "./football/FixtureDetailPage.js";
import { FootballPage } from "./football/FootballPage.js";
import { HomePage } from "./home/HomePage.js";
import { PerformancePage } from "./performance/PerformancePage.js";
import { AuthBoundary } from "./shared/AuthBoundary.js";
import { Layout } from "./shared/Layout.js";
import { TicketDetailPage } from "./tickets/TicketDetailPage.js";
import { TicketsPage } from "./tickets/TicketsPage.js";

export function App(): JSX.Element {
  return (
    <AuthBoundary>
      <Layout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/football" element={<FootballPage />} />
          <Route path="/football/:fixtureId" element={<FixtureDetailPage />} />
          <Route path="/tickets" element={<TicketsPage />} />
          <Route path="/tickets/:ticketId" element={<TicketDetailPage />} />
          <Route path="/aviator" element={<AviatorPage />} />
          <Route path="/performance" element={<PerformancePage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/admin" element={<AdminHome />} />
          <Route path="/admin/jobs" element={<AdminJobsPage />} />
          <Route path="/admin/reports" element={<AdminReportsPage />} />
        </Routes>
      </Layout>
    </AuthBoundary>
  );
}
