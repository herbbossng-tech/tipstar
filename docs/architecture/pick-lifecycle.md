# Pick Lifecycle: Publication, Settlement, Performance

## Publication (`packages/picks`)

`PickEngine.publish(candidate: PickCandidate)`:

- Refuses any candidate whose `decisionStatus !== "qualified"`.
- Is **idempotent**: keyed on `sourceIntelligenceResultId`. Publishing the
  same qualified decision twice returns the existing pick rather than
  creating a duplicate (Section 24).
- Creates a `Pick` with `finalResult: "pending"` and
  `settlementStatus: "unsettled"` — settlement is a separate, later step,
  never decided at publish time.

## Immutability & corrections

Once created, a `Pick`'s identity fields (`id`, `sourceIntelligenceResultId`,
`eventId`, `agentType`, `sport`, `market`, `selection`, `publishedAt`) can
never change — enforced at the database layer by the
`enforce_pick_immutability()` trigger in the initial migration, not just by
convention in application code.

A narrow set of fields (`CORRECTABLE_PICK_FIELDS` in
`packages/picks/src/engine.ts`) may be corrected via `PickEngine.correct()`,
which requires a non-empty `reason` and writes a `PickCorrection` audit
record (original value, corrected value, who, when, why) atomically with
the update (`PickRepository.applyCorrection`). The `pick_corrections` table
is itself append-only (a database trigger rejects `UPDATE`/`DELETE`).

## Settlement (`packages/settlement`)

`SettlementEngine.settle({ pickId, finalResult })`:

- Is **idempotent**: settling an already-settled pick is a safe no-op that
  returns the original settlement rather than overwriting it with a
  different result. This is enforced in code
  (`packages/settlement/src/engine.ts`) and backstopped by the database
  trigger's rule that `settlement_status` can never move backward from
  `settled` to `unsettled`.
- Never deletes a pick regardless of outcome — a loss is settled and
  recorded exactly like a win (Section 14, "No Hidden Losses").
- `cancel(pickId)` handles void/abandoned events, and itself refuses to
  cancel an already-settled pick.

## Performance (`packages/performance`)

`calculatePerformanceStats(picks)` and its breakdown/time-series helpers
(`performanceBySport`, `performanceByAgent`, `performanceByMarket`,
`performanceByLeague`, `performanceByConfidenceRange`, `performanceOverTime`)
are **pure functions over settled `Pick` records** — there is no code path
that accepts a manually entered win/loss count. Every `Pick`, including
losses and voids, is counted; nothing is filtered out to make performance
look better (see `packages/performance/src/stats.test.ts`,
"counts losses and voids — never hides them").

Profit/loss and ROI assume a flat 1-unit stake per pick, consistent with
Tipstar never taking custody of user funds or dictating stake size
(Section 18).
