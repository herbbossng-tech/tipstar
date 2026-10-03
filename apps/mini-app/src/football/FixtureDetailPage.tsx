import { useParams } from "react-router-dom";
import { useAuthIdentity } from "../auth/AuthContext.js";
import { getFixtureIntelligence } from "../api/footballApi.js";
import { useQuery } from "../hooks/useQuery.js";
import { EmptyState } from "../shared/EmptyState.js";
import { LoadingState } from "../shared/LoadingState.js";
import { QueryErrorState } from "../shared/QueryErrorState.js";
import { StatusBadge } from "../shared/StatusBadge.js";
import { ValueCard } from "../shared/ValueCard.js";
import { describeMatchStatus } from "../shared/statusPresentation.js";
import { formatDateTime } from "../shared/format.js";

/** Match Intelligence View (Section 09 §12/§13/§14/§15). Every market's probability/odds/edge/EV is shown as a separate, labeled figure — never a single "AI score", never a "best bet" label. */
export function FixtureDetailPage(): JSX.Element {
  const { fixtureId } = useParams<{ fixtureId: string }>();
  const { session } = useAuthIdentity();
  const query = useQuery(() => getFixtureIntelligence(session.token, fixtureId!), [session.token, fixtureId]);

  if (!fixtureId) {
    return <EmptyState title="Fixture not found" message="No fixture was specified." />;
  }

  return (
    <section className="page">
      {query.status === "loading" ? <LoadingState label="Loading match intelligence…" /> : null}
      {query.status === "error" ? <QueryErrorState code={query.code} message={query.message} onRetry={query.refetch} /> : null}

      {query.status === "success" ? (
        <>
          <div className="match-header">
            <h1>
              {query.data.fixture.homeTeam?.name ?? "Unknown team"} vs {query.data.fixture.awayTeam?.name ?? "Unknown team"}
            </h1>
            <p className="page__subtitle">{query.data.fixture.competition?.name ?? "Unknown competition"}</p>
            <div className="match-header__meta">
              <StatusBadge {...describeMatchStatus(query.data.fixture.status)} />
              <span>{formatDateTime(query.data.fixture.scheduledKickoffAt)}</span>
            </div>
            {query.data.result ? (
              <p className="match-header__result">
                Final score: {query.data.result.homeGoals}-{query.data.result.awayGoals}
              </p>
            ) : null}
          </div>

          <h2 className="section-heading">Markets</h2>
          {query.data.markets.length === 0 ? (
            <EmptyState title="No eligible markets" message="No market evaluation is available for this fixture yet." />
          ) : (
            <div className="card-list">
              {query.data.markets.map((market) => (
                <ValueCard key={`${market.marketType}-${market.selection}-${market.line ?? "none"}`} market={market} />
              ))}
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
