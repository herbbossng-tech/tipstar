import type { MarketIntelligenceView } from "../api/types.js";
import { DecisionBadge } from "./DecisionBadge.js";
import { formatDateTime, formatMarketLabel, formatOdds, formatProbability, formatSignedPercent } from "./format.js";

/**
 * One market's real Value Engine output (Section 09 §12/§14/§15 — Match
 * Intelligence View / Value Display / No Unsupported "Best Bet").
 * Probability, odds, fair odds, edge, and EV are always shown as
 * SEPARATE labeled figures — never collapsed into one "AI score", never
 * relabeled as a certainty or a "best bet" ranking. Every value is read
 * straight from the server's own `value_evaluations` row; nothing here
 * computes EV, edge, or fair odds.
 */
export function ValueCard({ market }: { readonly market: MarketIntelligenceView }): JSX.Element {
  const outcome = market.finalizedDecision?.outcome ?? market.valueEngineDecision;
  const reasons = market.finalizedDecision?.reasons ?? market.valueEngineReasons;

  return (
    <div className="value-card">
      <div className="value-card__header">
        <span className="value-card__market">{formatMarketLabel(market.marketType, market.selection, market.line)}</span>
        <DecisionBadge outcome={outcome} />
      </div>
      <dl className="value-card__grid">
        <div>
          <dt>Model probability</dt>
          <dd>{formatProbability(market.modelProbability)}</dd>
        </div>
        <div>
          <dt>Market odds</dt>
          <dd>{formatOdds(market.marketOdds)}</dd>
        </div>
        <div>
          <dt>Fair odds</dt>
          <dd>{formatOdds(market.fairOdds)}</dd>
        </div>
        <div>
          <dt>Edge</dt>
          <dd>{formatSignedPercent(market.edge)}</dd>
        </div>
        <div>
          <dt>Expected value</dt>
          <dd>{formatSignedPercent(market.expectedValue)}</dd>
        </div>
      </dl>
      {reasons.length > 0 ? <p className="value-card__reasons">{reasons.join(", ")}</p> : null}
      <p className="value-card__footer">
        {market.modelVersion ? `Model ${market.modelVersion} · ` : ""}
        Evaluated {formatDateTime(market.evaluatedAt)}
      </p>
    </div>
  );
}
