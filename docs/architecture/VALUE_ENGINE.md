# Value Engine (Section 07)

`packages/football-engine/src/decision.ts`'s `evaluateValue()`, plus
`packages/football-engine/src/market-mapping.ts` and
`packages/market-engine/src/types.ts`, which it depends on. This is the
**only** place model probability, market odds, fair odds, edge, and
expected value are computed and combined — nothing upstream (Section 05)
or downstream (Ticket/Risk/Execution) recomputes any of these numbers.

## Market Engine integration (§A/§5)

`@sport-os/market-engine`'s `MarketType` is the canonical, locked set of
markets this codebase understands:

```
match_result_1x2, over_under, both_teams_to_score, double_chance,
team_totals, asian_handicap, european_handicap, corners, cards,
correct_score, first_half, second_half
```

`MarketObservation` is the canonical, persisted market snapshot
(`odds`/`oddsTimestamp`/`status`/`line`/`schemaVersion`) — distinct from
Section 04's `odds_observations` (raw provider ingestion feeding
features/backtesting). See `market_observations` in
[`RISK_EXECUTION.md`](./RISK_EXECUTION.md)'s database section.

## Probability → Market mapping (§B/§C)

`mapProbabilityToMarket(inputs, marketType, line?)`
(`football-engine/market-mapping.ts` — lives here, not in
`market-engine`, because `football-engine` already depends on
`market-engine` and putting it the other way round would create a
circular package dependency) turns Section 05's raw Monte Carlo output
(`probability1x2`, `btts`, `overUnder`, `correctScoreDistribution`) into
a market-specific probability, **deterministically**:

- `MATCH_RESULT_1X2` / `DOUBLE_CHANCE` (`P(1X)=H+D`, `P(X2)=D+A`,
  `P(12)=H+A`) / `BOTH_TEAMS_TO_SCORE` / `OVER_UNDER` (keyed by line) /
  `CORRECT_SCORE` — all supported, always computed from real Monte Carlo
  output, never invented.
- `TEAM_TOTALS`, `ASIAN_HANDICAP`, `EUROPEAN_HANDICAP`, `CORNERS`,
  `CARDS`, `FIRST_HALF`, `SECOND_HALF` — **not** derivable from today's
  Monte Carlo output (no per-team-total, no handicap-line, no
  corners/cards, no half-by-half distribution exists). Requesting one of
  these returns `{ ok: false, reason: "MARKET_UNSUPPORTED" }` — never a
  manufactured probability. See `market-mapping.test.ts`'s `it.each` over
  all 7 unsupported markets, proving this holds even when other optional
  input data happens to be present.

## Fair odds, edge, expected value (§D/§9/§10)

All three are pure functions of a **model-derived** probability — never
bookmaker odds inverted or de-vigged:

```ts
fairOdds        = computeFairOdds(modelProbability)       // = 1 / probability
impliedOdds     = computeImpliedProbability(marketOdds)    // = 1 / marketOdds
edge            = modelProbability - impliedProbability    // distinct from EV
expectedValue   = modelProbability * marketOdds - 1        // distinct from edge
```

`edge` and `expectedValue` are **not the same number** and are never
conflated — a policy can require a minimum edge, a minimum EV, or both,
independently (`DecisionPolicy.minimumEdge` / `minimumExpectedValue`).
Market overround (`computeMarketOverround()`) is measured only, from the
observed odds across a market's selections — this codebase never
de-vigs/removes the margin automatically; that stays a documented,
measurable fact about the observed market, not something the Value
Engine "corrects for."

## Odds validity (§ Odds Validity Checks)

`checkOddsValidity(observation, evaluationTime, config)`
(`market-engine/types.ts`) is the single source of truth for whether an
odds figure may be used at all — checked **before** any edge/EV
computation:

| Failure | Meaning |
|---|---|
| `MISSING_ODDS` | `odds` is `null` |
| `NON_POSITIVE_ODDS` / `NON_FINITE_ODDS` | `odds <= 1` or not finite |
| `STALE_ODDS` | `oddsTimestamp` older than `config.maxOddsAgeSeconds` |
| `FUTURE_TIMESTAMP` | `oddsTimestamp` is after `evaluationTime` |
| `MARKET_SUSPENDED` / `MARKET_CANCELLED` | `observation.status` says so |

`OddsValidityConfig.maxOddsAgeSeconds` has **no default anywhere** in
this codebase — every caller of `evaluateValue()` must supply a real
`DecisionPolicy.oddsValidity` explicitly (§35's "no hardcoded staleness
threshold"). A failed check maps to a structured
`DecisionReasonCode` (`ODDS_STALE`/`ODDS_MISSING`/`ODDS_INVALID`/
`MARKET_SUSPENDED`/`MARKET_CANCELLED`) and the outcome is always `WAIT`
— never a value computed from stale/invalid odds, and never silently
skipped to `NO_TRADE`/`BET`.

## `evaluateValue()` — the Value Engine itself

```ts
evaluateValue(deps: ValueEngineDependencies, params, policy: DecisionPolicy): Promise<ValueAssessment>
```

1. Fetches the caller's `PredictionSnapshot` (`deps.getPredictionSnapshot`)
   — absent → `PREDICTION_UNAVAILABLE` / `INSUFFICIENT_DATA`, never
   fabricated.
2. Maps it to the requested market (`mapProbabilityToMarket`) — fails →
   `MARKET_UNSUPPORTED`.
3. Fetches the market observation (`deps.getMarketObservation`) — absent
   → `WAIT` / `ODDS_MISSING`.
4. Runs `checkOddsValidity()` — fails → `WAIT` / the mapped reason code.
5. Computes `impliedProbability`, `edge`, `expectedValue` — only now, only
   from real, validated inputs.
6. Applies `policy` thresholds (data quality, model agreement, edge, EV),
   accumulating every violated `DecisionReasonCode` — not just the first.
7. Resolves the final `DecisionOutcome`: `DATA_QUALITY_LOW` →
   `INSUFFICIENT_DATA` (hard block, overrides a positive edge/EV);
   `MODEL_DISAGREEMENT` → `NO_TRADE` (hard block); any other reason
   present → `NO_EDGE`; no reasons at all → `BET`.

`ValueAssessment.qualifies` is `true` **only** when `decision === BET` —
a single, unambiguous field every downstream consumer (the Football
Decision Agent, `ticketLegFromValueAssessment`) already reads.

## No betting-guarantee language, anywhere

`decision.test.ts` structurally checks `JSON.stringify(result)` for
`guarantee|sure.?win|risk.?free` on every code path, including a `BET`
outcome — this is not a documentation promise, it's an enforced test
invariant. `ValueAssessment` also has no `confidence` field distinct from
`calibratedProbability`/model agreement — Section 07 never invents a
second, separate "confidence score."

## `StandardDecisionEngine` — the `DecisionEngine` interface, for real

`DecisionEngine.assess(eventId, marketType, selection)` (fixed by Section
06, no `line` parameter) is satisfied by `StandardDecisionEngine`, which
delegates to a richer `assessWithLine(eventId, marketType, selection,
line)` method that exists only on the concrete class — the interface
itself is unchanged, so `@sport-os/agents`' Football Decision Agent
(constructed against `DecisionEngine`, not the concrete class) keeps
working without modification. `NotImplementedDecisionEngine` remains the
default construction for any caller that hasn't wired real
`ValueEngineDependencies`/`DecisionPolicy` yet.

## See also

- [`DECISION_ARCHITECTURE.md`](./DECISION_ARCHITECTURE.md) — the full
  pipeline this layer is one part of.
- [`TICKET_ENGINE.md`](./TICKET_ENGINE.md) — how a `BET` `ValueAssessment`
  becomes a `TicketLeg`.
- `packages/football-engine/src/decision.test.ts` — 14 tests covering
  every branch above.
- `packages/football-engine/src/market-mapping.test.ts` — 15 tests,
  including the unsupported-market matrix.
- `packages/market-engine/src/types.test.ts` — 15 tests covering fair
  odds, implied probability, overround, and every `checkOddsValidity()`
  branch.
