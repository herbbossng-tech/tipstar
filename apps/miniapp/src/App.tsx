import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider.js";
import { ProtectedRoute } from "./auth/ProtectedRoute.js";
import { NavBar } from "./components/NavBar.js";
import { AccountPage } from "./pages/AccountPage.js";
import { HomePage } from "./pages/HomePage.js";
import { MatchesPage } from "./pages/MatchesPage.js";
import { PerformancePage } from "./pages/PerformancePage.js";
import { PicksPage } from "./pages/PicksPage.js";
import { useBackButton } from "./telegram/useBackButton.js";

export function App(): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const { status } = useAuth();

  // Reusable Back Button abstraction (Section 25): only appears away from
  // the root of the bottom-nav hierarchy, and navigates back in-app.
  useBackButton(() => navigate(-1), location.pathname !== "/");

  return (
    <div className="app-shell">
      <main className="app-content">
        <ProtectedRoute>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/home" element={<HomePage />} />
            <Route path="/picks" element={<PicksPage />} />
            <Route path="/matches" element={<MatchesPage />} />
            <Route path="/performance" element={<PerformancePage />} />
            <Route path="/account" element={<AccountPage />} />
          </Routes>
        </ProtectedRoute>
      </main>
      {status === "authenticated" ? <NavBar /> : null}
    </div>
  );
}
