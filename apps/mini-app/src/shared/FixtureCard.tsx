import { Link } from "react-router-dom";
import type { FixtureSummary } from "../api/types.js";
import { StatusBadge } from "./StatusBadge.js";
import { describeMatchStatus } from "./statusPresentation.js";
import { formatDateTime } from "./format.js";

/** One fixture row in the Football list (Section 09 §11). Never implies a prediction exists when it does not — `hasIntelligence`/`hasMarketData` are the real, server-reported existence flags, rendered as plain factual tags. */
export function FixtureCard({ fixture }: { readonly fixture: FixtureSummary }): JSX.Element {
  const status = describeMatchStatus(fixture.status);
  return (
    <Link to={`/football/${fixture.fixtureId}`} className="fixture-card">
      <div className="fixture-card__teams">
        <span>{fixture.homeTeam?.name ?? "Unknown team"}</span>
        <span className="fixture-card__vs">vs</span>
        <span>{fixture.awayTeam?.name ?? "Unknown team"}</span>
      </div>
      <div className="fixture-card__meta">
        <span>{fixture.competition?.name ?? "Unknown competition"}</span>
        <span>{formatDateTime(fixture.scheduledKickoffAt)}</span>
      </div>
      <div className="fixture-card__footer">
        <StatusBadge {...status} />
        <span className={`tag${fixture.hasIntelligence ? "" : " tag--muted"}`}>{fixture.hasIntelligence ? "Intelligence available" : "No intelligence yet"}</span>
      </div>
    </Link>
  );
}
