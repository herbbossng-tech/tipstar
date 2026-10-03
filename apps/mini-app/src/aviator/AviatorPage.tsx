import { useAuthIdentity } from "../auth/AuthContext.js";
import { hasEntitlement } from "../auth/entitlements.js";
import { useProfile } from "../auth/useProfile.js";
import { EmptyState } from "../shared/EmptyState.js";
import { LoadingState } from "../shared/LoadingState.js";
import { NotEntitledNotice } from "../shared/NotEntitledNotice.js";
import { QueryErrorState } from "../shared/QueryErrorState.js";

/**
 * Aviator Command Center (Section 09 §21/§22/§23). Honest "no data
 * source" state — see docs/architecture/OPEN_QUESTIONS.md: no Aviator
 * signal, round, or Double Bet history is persisted anywhere in this
 * codebase yet (`aviator-engine`'s `signal-engine.ts`/`double-bet.ts`
 * and `GlobalDailyRiskController` are real, pure computation with no
 * backing database table — see MODULE_BOUNDARIES.md's "Aviator... no
 * section assigned yet"). Rather than invent a signals/rounds table (new
 * business logic outside Section 09's UI-only scope — see §68's stop
 * conditions), this screen tells the truth: the feature is entitled but
 * has no real data to show yet. Never a fabricated signal, target, or
 * P&L figure.
 */
export function AviatorPage(): JSX.Element {
  const { session } = useAuthIdentity();
  const profileQuery = useProfile(session.token);

  return (
    <section className="page">
      <h1>Aviator</h1>

      {profileQuery.status === "loading" ? <LoadingState label="Loading your account…" /> : null}
      {profileQuery.status === "error" ? <QueryErrorState code={profileQuery.code} message={profileQuery.message} onRetry={profileQuery.refetch} /> : null}

      {profileQuery.status === "success" && !hasEntitlement(profileQuery.data, "aviator_analysis") ? <NotEntitledNotice featureLabel="Aviator intelligence" /> : null}

      {profileQuery.status === "success" && hasEntitlement(profileQuery.data, "aviator_analysis") ? (
        <EmptyState title="Aviator unavailable" message="Aviator signal and round history is not yet available in this build." />
      ) : null}
    </section>
  );
}
