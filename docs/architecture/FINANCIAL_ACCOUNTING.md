# Financial Accounting (Section 08)

This document is the precise answer to the question that motivated all
of Section 08: **when is a number real money, and when is it an
estimate?** Every type and function described here exists to keep those
two cases from ever being confused, in either direction.

## The central rule

> **Actual financial P&L exists ONLY when there is a confirmed executed
> wager with an actual recorded stake/return.**

A losing prediction is not automatically a financial loss. A winning
prediction is not automatically a financial gain. The only thing that
turns an analytical settlement outcome into a financial one is a real,
confirmed execution.

## `Money` and currency safety

```ts
// @sport-os/settlement-engine/types.ts
type Currency = string;              // ISO 4217 code, application-validated — no fixed operating-currency enum exists
interface Money { amount: number; currency: Currency; }
```

`@sport-os/settlement-engine/financial.ts` provides the only sanctioned
arithmetic over `Money`:

- `assertSameCurrency(a, b)` — throws `ValidationError(code:
  "CURRENCY_MISMATCH")` on any mismatch.
- `addMoney` / `subtractMoney` / `sumMoney` — all currency-checked;
  `sumMoney([])` is `undefined` (there is no "zero of no currency").

**No FX conversion layer exists in this codebase.** "Do not aggregate
NGN/KES/GHS/etc. into one numerical P&L without an explicit FX conversion
layer... never silently convert" (§44) is enforced by these functions
*refusing* to combine two different currencies, rather than by a
discipline the caller has to remember. Every aggregation in this section
(`buildPerformanceLedgerEntry`, `settleTicket`, `settleDoubleBet`) is
single-currency by construction — the caller is responsible for grouping
by currency before calling in, and a cross-currency call throws instead
of quietly mis-summing.

## `PayoutSource`: PROVIDER vs CALCULATED

```ts
const PayoutSource = { PROVIDER: "PROVIDER", CALCULATED: "CALCULATED" } as const;
```

This is the single most important distinction in the whole settlement
layer.

- **`PROVIDER`** — a real execution integration supplied this payout. The
  only source that may ever populate `actualPayout` / contribute to
  `netPnl`/`roi`.
- **`CALCULATED`** — this codebase derived a figure from `stake ×
  combined odds` (or `0` for LOST, or `stake` for VOID/PUSH). A labeled
  estimate, **never** written to `actualPayout`, **never** fed into
  `netPnl`/`roi`.

`TicketSettlement.calculatedReturn` (the CALCULATED figure) and
`TicketSettlement.actualPayout` (only ever PROVIDER) are two separate
fields that can legitimately coexist: a ticket with a confirmed stake but
no provider payout yet has a real `calculatedReturn` and a `null`
`actualPayout`. **"A CALCULATED figure may never masquerade as actual"**
is enforced twice — once in `buildTicketSettlement()`
(`football-engine/settlement.ts`, which only sets `actualPayout` when
`execution.payoutSource === PROVIDER`), and again as a real database
`CHECK` constraint on `settlements`
(`check ((actual_payout_amount is null) or (payout_source =
'PROVIDER'))`, proven by `tests/database/120_section08_rls_cases.sql`
TEST 8).

## Net P&L and ROI

```ts
// financial.ts
function computeNetPnl(actualStake: Money | null, actualPayout: Money | null): Money | null
function computeRoi(netPnl: Money | null, actualStake: Money | null): number | null
```

`net_pnl = actual_payout - actual_stake`. `roi = net_pnl / actual_stake`,
only when `actual_stake > 0`. Both return `null` — never `0`,
`Infinity`, or `NaN` — whenever an input is unknown. **This is the
mechanism that keeps "zero P&L" and "no financial data" distinguishable
states**: a ticket that was executed, paid out exactly its stake back
(a real, computed `netPnl.amount === 0`), and a ticket that was never
executed at all (`netPnl === null`) are not the same thing anywhere in
this codebase.

Critically, `TicketSettlement.netPnl`/`.roi` are derived **only from
`actualPayout`** — never from `calculatedReturn`. A ticket settled with
only a `CALCULATED` payout source has a real `calculatedReturn` figure
but `netPnl`/`roi` both stay `null`. This is the literal enforcement of
§51: "never derive actual P&L from model probability, EV, fair odds, risk
limit, proposed stake, Telegram publication, or ticket proposal alone."

## Actual stake — exists only from confirmed execution

`FootballExecutionAccounting` (`football-engine/settlement.ts`) is the
caller-supplied bridge from Section 07's real `execution_requests`/
`execution_results` into settlement:

```ts
interface FootballExecutionAccounting {
  stake: Money;
  payout: Money | undefined;   // undefined = not known yet
  payoutSource: PayoutSource;
}
```

When `SettleTicketParams.execution` is `undefined`, `TicketSettlement.
actualStake` is `null` — never inferred from the ticket's proposed
`stake`, a risk limit, or a "maximum allowed stake" default. This is
enforced structurally: `settleTicket()` never reads
`TicketRecord.stake` for financial purposes at all, only `execution.
stake`.

## Expected vs. actual — kept permanently separate

| Concept | Where it lives | Computed from |
|---|---|---|
| Expected Value (EV) | `ValueAssessment.expectedValue` (Section 07, `decision.ts`) | Model probability × market odds, pre-decision. |
| Expected Return | The EV-implied return for a proposed stake — never persisted as a settlement field; it's an input, not an outcome. |
| Calculated Return | `TicketSettlement.calculatedReturn` | Stake × realized combined odds, post-settlement, clearly labeled. |
| Actual Return | `TicketSettlement.actualPayout` | Real execution provider only. |
| Actual P&L / ROI | `TicketSettlement.netPnl` / `.roi` | `actualPayout` only. |

A positive-EV decision can still produce a negative actual result — that
never retroactively invalidates the EV calculation (§16). Nothing in this
codebase recomputes or "corrects" a historical `ValueAssessment` based on
how its ticket eventually settled; `PerformanceRecordInput.expectedEv` is
carried alongside the realized outcome specifically so both can be
compared over a large sample, never collapsed into one number.

## Paper vs. live (`LedgerMode`)

```ts
const LedgerMode = { PAPER: "PAPER", LIVE: "LIVE" } as const;
```

Every settlement and every `PerformanceRecordInput` carries a
`LedgerMode` — never inferred, never defaulted silently by a downstream
consumer. `buildPerformanceLedgerEntry()` filters `records` by
`params.ledgerMode` **before** any aggregation runs
(`settlement-engine/performance.ts`), so a PAPER record can never
contribute to a LIVE entry, and vice versa, regardless of what the caller
happened to pass in the same array.

`simulateBacktestDecision()` (`football-engine/backtest.ts`) hard-codes
`ledgerMode: LedgerMode.PAPER` on every `BacktestSettlement` it produces
— there is no code path by which a backtest can write a LIVE record. See
"PAPER's own actual-figures convention" below for the one place PAPER
and LIVE deliberately compute their "actual" numbers differently.

### PAPER's own actual-figures convention

For a **LIVE** football settlement, `actualPayout` is strictly
PROVIDER-sourced — a `CALCULATED` figure never populates it (see above).
For a **PAPER/backtest** settlement, there is no external provider to
confirm against by definition, so `backtestToPerformanceRecordInput()`
(`football-engine/backtest.ts`) treats the backtest's own
`calculatedReturn` as that record's `actualPayout` for aggregation
purposes — it is never labeled `PayoutSource.PROVIDER`, and it never
reaches a LIVE ledger (the `LedgerMode.PAPER` filter above guarantees
that). This is the one deliberate, documented exception to "CALCULATED
never becomes actual," scoped entirely to the PAPER ledger, which exists
precisely so a backtest's own simulated numbers are usable as *its own*
performance data without ever being mistaken for real execution.

## Aviator financial accounting

`DoubleBetSettlement` (`aviator-engine/settlement.ts`) reuses Section
06's already-real `combineDoubleBetLegs()` arithmetic (stake × actual
exit multiplier) rather than recomputing anything — this module only
labels the existing real numbers with `SettlementStatus`/`LedgerMode` so
Aviator results are reportable through the same `PerformanceLedgerEntry`
shape football settlements use. `actualPayout` stays `null` until
**both** legs have independently settled (`combineDoubleBetLegs` itself
returns `totalReturn: undefined` until then) — never a fabricated
interim payout for a still-open leg.

## Currency in the database

Every `Money` field (`settlements.actual_stake_amount` /
`actual_stake_currency`, etc.) is stored as an amount/currency pair with
a `CHECK` tying their nullability together — `(amount IS NULL) = (currency
IS NULL)`, proven by `tests/database/120_section08_rls_cases.sql` TEST 9.
There is no numeric-only money column anywhere in the Section 08 schema.

## See also

- [`SETTLEMENT_ARCHITECTURE.md`](./SETTLEMENT_ARCHITECTURE.md) — how
  these figures get produced per ticket.
- [`PERFORMANCE_ARCHITECTURE.md`](./PERFORMANCE_ARCHITECTURE.md) — how
  they aggregate across many tickets.
- `packages/settlement-engine/src/financial.test.ts` — 17 tests.
