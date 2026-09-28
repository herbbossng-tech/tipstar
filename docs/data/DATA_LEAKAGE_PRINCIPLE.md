# Data Leakage Principle

**Every future football feature must represent information that was
genuinely available before kickoff.** This is an architectural rule,
locked in Section 01, documented here for every later section to build
against — no feature, model, or calibration step is implemented yet, but
the rule constrains how they must be built when they are.

## What this requires of future training systems

- **Time-aware validation.** Cross-validation splits must respect
  chronological order — a model is never validated against data that
  occurred before data it was trained on in wall-clock time relative to
  the event being predicted.
- **Prevent future leakage.** A feature for event E, computed `asOf` some
  timestamp, must only read data that existed at or before that
  timestamp. `FootballFeatureEngineer.buildFeatures(eventId, asOf)` and
  `AviatorFeatureEngine.buildFeatures(asOfRoundId)`
  (`packages/football-engine`, `packages/aviator-engine`) both take an
  explicit "as of" boundary for exactly this reason — it is part of the
  interface, not an implementation detail to remember later.
- **Fit scalers/encoders/models only on their training window.** Any
  normalization statistic (mean, std, encoding table) must be computed
  from the training split alone and then applied to validation/test/
  production data — never fit on the full dataset first.
- **Preserve point-in-time feature availability.** The Feature Store
  (`FootballFeatureStore`) must be able to answer "what did this feature
  look like as of timestamp T", not just "what does it look like now" —
  a feature store that only tracks current state cannot be used safely
  for backtesting or training without reintroducing leakage.

## Why this belongs in Section 01

Getting this wrong is invisible until a backtest looks unrealistically
good — by the time real Football/Aviator models exist, the pipeline's
data-access patterns (ingestion → feature-store → models) need to already
make leakage structurally hard, not something bolted on afterward. This
document and the `asOf` parameters in the Section 01 interfaces are that
structural constraint.
