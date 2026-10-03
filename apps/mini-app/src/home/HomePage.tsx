import { useAuthIdentity } from "../auth/AuthContext.js";
import { hasEntitlement } from "../auth/entitlements.js";
import { useProfile } from "../auth/useProfile.js";
import { LicenseCard } from "../shared/LicenseCard.js";
import { LoadingState } from "../shared/LoadingState.js";
import { NotEntitledNotice } from "../shared/NotEntitledNotice.js";
import { QueryErrorState } from "../shared/QueryErrorState.js";
import { FootballAvailabilityCard } from "./FootballAvailabilityCard.js";
import { PerformanceSnapshotCard } from "./PerformanceSnapshotCard.js";
import { RecentTicketsCard } from "./RecentTicketsCard.js";

/**
 * The command center (Section 09 §9 — Home). Summarizes real,
 * server-provided state only: no EV/probability/risk/settlement/P&L is
 * ever computed here — every card fetches its own already-computed
 * figures from the real Section 07/08 schema.
 */
export function HomePage(): JSX.Element {
  const { identity, session } = useAuthIdentity();
  const profileQuery = useProfile(session.token);

  return (
    <section className="page">
      <h1>Home</h1>
      <p className="page__subtitle">Welcome back, {identity.firstName}</p>

      {profileQuery.status === "loading" ? <LoadingState label="Loading your account…" /> : null}
      {profileQuery.status === "error" ? <QueryErrorState code={profileQuery.code} message={profileQuery.message} onRetry={profileQuery.refetch} /> : null}

      {profileQuery.status === "success" ? (
        <div className="page__stack">
          <LicenseCard license={profileQuery.data.license} />

          {hasEntitlement(profileQuery.data, "football_analysis") ? <FootballAvailabilityCard sessionToken={session.token} /> : <NotEntitledNotice featureLabel="Football intelligence" />}

          {hasEntitlement(profileQuery.data, "football_tickets") ? <RecentTicketsCard sessionToken={session.token} /> : null}

          {hasEntitlement(profileQuery.data, "advanced_analytics") ? <PerformanceSnapshotCard sessionToken={session.token} /> : null}
        </div>
      ) : null}
    </section>
  );
}
