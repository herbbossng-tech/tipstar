# Common Decision Engine

`packages/decision-engine` is the single gate every agent's
`IntelligenceResult` passes through before it may become a published
`Pick`. It depends only on `packages/types` — it has no knowledge of which
agent produced a result.

## States

| Status | Meaning |
|---|---|
| `QUALIFIED` | All publication criteria met — eligible for `PickEngine.publish()`. |
| `WAIT` | Data is present but stale, or a required field (market odds, probability, confidence) is missing. |
| `MONITOR` | Confidence is above the reject floor but below the qualify bar — worth watching, not yet publishable. |
| `NO_TRADE` | Risk score too high, or expected value is non-positive. |
| `REJECTED` | Confidence is below the reject floor — too uncertain to act on. |
| `INSUFFICIENT_DATA` | The intelligence result itself reported insufficient data, had zero evidence, or errored. |

## Evaluation order

See `packages/decision-engine/src/engine.ts` (`DecisionEngine.evaluate`):

1. Result status `error` or `insufficient_data` → `INSUFFICIENT_DATA`.
2. Evidence count below `minEvidenceCount` → `INSUFFICIENT_DATA`.
3. Data older than `maxDataAgeSeconds` → `WAIT`.
4. `requireMarketOdds` and no market odds → `WAIT`.
5. Missing probability or confidence → `WAIT`.
6. Risk score above `maxRiskScore` → `NO_TRADE`.
7. Expected value below `minExpectedValue` → `NO_TRADE`.
8. Confidence below `minConfidenceToReject` → `REJECTED`.
9. Confidence below `minConfidenceToQualify` → `MONITOR`.
10. Otherwise → `QUALIFIED`.

Every branch records a human-readable reason in `DecisionOutcome.reasons`,
persisted alongside the outcome for audit purposes.

## Configurability

`DecisionCriteria` (`packages/decision-engine/src/criteria.ts`) is passed
into the constructor; `DEFAULT_DECISION_CRITERIA` is a starting point, not
a claim that these are the final production thresholds. Tuning criteria
per-sport or per-agent (if ever needed) means constructing a
`DecisionEngine` with different criteria — never forking the evaluation
logic itself.

## Why this never "forces" a prediction

Steps 3–7 all fail toward `WAIT`/`NO_TRADE`/`MONITOR`, never toward
`QUALIFIED`. `QUALIFIED` is the one state that requires every criterion to
positively pass — see `packages/decision-engine/src/engine.test.ts` for a
case-by-case test of each branch.
