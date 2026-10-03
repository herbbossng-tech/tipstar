import { useState } from "react";
import { useAuthIdentity } from "../auth/AuthContext.js";
import { getFootballFixtures } from "../api/footballApi.js";
import { useQuery } from "../hooks/useQuery.js";
import { EmptyState } from "../shared/EmptyState.js";
import { FixtureCard } from "../shared/FixtureCard.js";
import { LoadingState } from "../shared/LoadingState.js";
import { QueryErrorState } from "../shared/QueryErrorState.js";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Football Command Center (Section 09 §11). A real date selector over real fixtures — never a fabricated "today's picks" list. */
export function FootballPage(): JSX.Element {
  const { session } = useAuthIdentity();
  const [date, setDate] = useState(todayIso);
  const query = useQuery(() => getFootballFixtures(session.token, { date }), [session.token, date]);

  return (
    <section className="page">
      <h1>Football</h1>
      <label className="field">
        <span className="field__label">Date</span>
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="field__input" />
      </label>

      {query.status === "loading" ? <LoadingState label="Loading fixtures…" /> : null}
      {query.status === "error" ? <QueryErrorState code={query.code} message={query.message} onRetry={query.refetch} /> : null}
      {query.status === "success" && query.data.fixtures.length === 0 ? <EmptyState title="No fixtures available" message="No fixtures are scheduled for this date." /> : null}
      {query.status === "success" && query.data.fixtures.length > 0 ? (
        <div className="card-list">
          {query.data.fixtures.map((fixture) => (
            <FixtureCard key={fixture.fixtureId} fixture={fixture} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
