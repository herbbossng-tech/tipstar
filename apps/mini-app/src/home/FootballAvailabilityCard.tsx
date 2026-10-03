import { Link } from "react-router-dom";
import { getFootballFixtures } from "../api/footballApi.js";
import { useQuery } from "../hooks/useQuery.js";
import { LoadingState } from "../shared/LoadingState.js";
import { QueryErrorState } from "../shared/QueryErrorState.js";

/** Today's real fixture count — never a fabricated "X opportunities today" figure (Section 09 §9/§15). Links through to the full Football screen rather than duplicating its list here. */
export function FootballAvailabilityCard({ sessionToken }: { readonly sessionToken: string }): JSX.Element {
  const query = useQuery(() => getFootballFixtures(sessionToken), [sessionToken]);

  return (
    <Link to="/football" className="card card--link">
      <h2 className="card__title">Football</h2>
      {query.status === "loading" ? <LoadingState label="Loading fixtures…" /> : null}
      {query.status === "error" ? <QueryErrorState code={query.code} message={query.message} /> : null}
      {query.status === "success" ? <p className="card__stat">{query.data.fixtures.length} fixtures today</p> : null}
    </Link>
  );
}
