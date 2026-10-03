# Mini App UX (Section 09)

## Visual language

Professional sports-intelligence terminal: clean, data-dense but
readable, restrained. `styles.css` keeps the Section 01 dark/light CSS
custom-property system, extended with a `status-badge`/`tag`/`metric`
vocabulary shared by every screen — no casino-style gradients, no
decorative animation, no giant cards.

## Factual language only (§65)

`statusPresentation.ts`'s labels are deliberately plain: "Model
probability", "Expected value", "Decision", "Risk rejected", "Execution
unavailable", "Pending settlement", "Not executed". Nothing in this
codebase renders "GUARANTEED", "SURE BET", "LOCK", "FIXED", "100% WIN",
or a "BEST BET" ranking — `ValueCard` shows probability/odds/fair
odds/edge/EV as five separate labeled figures, never collapsed into one
score (§14/§15).

## Probability and value display (§13/§14)

```
Model probability    61.2%
Market odds           1.85
Fair odds              1.63
Edge                  +7.1%
Expected value        +13.2%
Decision               BET
```

Every figure comes from `ValueCard`'s `market` prop, itself read
verbatim from `/football-fixture-detail`'s `value_evaluations` row —
nothing in this component computes EV, edge, or fair odds. There is no
"win certainty" gauge, no confidence meter — Section 05 defines no
confidence metric beyond calibrated probability, so none is invented
here (§13/§30 of Section 08's own rule, carried through).

## Accumulator display (§17)

`TicketCard`/`TicketDetailPage` always render an accumulator as **one**
card/header labeled `"Accumulator · N legs"`, with legs listed
underneath via `TicketLegRow` — never as N separate ticket rows.
Ticket-level status (`StatusBadge` on the header) is visually distinct
from each leg's own settlement status (a second `StatusBadge` on each
`TicketLegRow`, only once the ticket is settled).

## Financial display rule (§25)

`formatMoney(value, fallback)` never converts a `null` `Money` into a
displayed "0" — every financial field in `TicketCard`/
`TicketDetailPage`/`PerformanceEntryCard` passes an explicit, honest
fallback string for its context: `"Not executed"` for an unexecuted
ticket's stake, `"Not available"` for an unsettled/unexecuted P&L,
`"Pending"` for a settled-but-payout-not-yet-known state. A real zero
(a settled push with net P&L of exactly 0) renders as a real "0.00",
distinct from any of these fallbacks — proven by
`TicketCard.test.tsx`'s "real ZERO net P&L" test.

## Currency display (§26)

`formatMoney` always renders the real currency code alongside the
amount (`Intl.NumberFormat` with `currencyDisplay: "code"`, e.g. "NGN
1,500.00") and never performs FX conversion — an unrecognized ISO code
falls back to a plain `"<code> <amount>"` string rather than throwing,
but the currency is never dropped or silently converted. Multi-currency
performance stays in separate `PerformanceLedgerEntryView` rows (each
one already single-currency by construction, from the backend) — the
UI never sums across them.

## Status presentation: icon + text, never color alone (§41)

Every `StatusBadge` renders a glyph (`✓`/`✕`/`!`/`•`/`i`, one per tone)
`aria-hidden` alongside its label text — removing color (a high-contrast
override, printing in grayscale) never loses the status's meaning, since
the text is always present and the glyph shapes are already distinct per
tone.

## Empty / loading / error states (§33/§34/§35)

- `EmptyState` — used for every "nothing here" case, with a specific,
  factual message per screen ("No fixtures available", "No tickets
  yet", "No eligible markets", "No performance data", "Aviator
  unavailable", feature-not-entitled). Never fake sample data in
  production — fixtures only exist in `*.test.ts`/`*.test.tsx` files.
- `LoadingState` — scoped per-card (Home's three cards each carry their
  own `useQuery`, so one slow card never blocks the others from
  rendering).
- `QueryErrorState`/`describeErrorCode` — differentiates
  `network_error`/`timeout`/session errors/`LICENSE_UNAVAILABLE`/
  `FEATURE_NOT_ENTITLED`/`ACCOUNT_SUSPENDED`/`NOT_FOUND` into distinct,
  factual messages; anything unrecognized falls back to the server's
  own already-safe message — never a raw stack trace.

## Data freshness (§49/§50)

`formatDateTime`/`formatDate` render every time-sensitive figure
(odds timestamp, evaluation timestamp, kickoff, created/settled at)
with its real timestamp rather than a relative "just now" that could go
stale silently. `minutesSince()` exists as the foundation for a future
staleness badge (e.g. flagging odds older than N minutes) — not yet
wired into a visible indicator in this build, since no odds-refresh SLA
is defined yet to calibrate a threshold against; using it without a real
threshold would be inventing one.

## Responsiveness and safe areas (§7/§40)

Mobile-first: a single-column `.page`/`.card-list` layout, a `640px` max
content width (comfortable on a tablet/desktop dev viewport without
stretching line lengths), `env(safe-area-inset-*)` applied to the
header, content bottom padding, and the fixed bottom nav. A `@media
(max-width: 360px)` rule tightens padding/nav font size for small
phones. No horizontal overflow — `body { overflow-x: hidden }` plus
`box-sizing: border-box` everywhere.

## Accessibility (§41)

- Every interactive control (`chip`, `button`, nav item) has a
  `min-height: 44px` touch target.
- Status uses icon + text (above), never color alone.
- `StatusBadge`'s glyph is `aria-hidden`; its label is the accessible
  name.
- Filter rows use `role="tablist"`/`role="tab"`/`aria-selected`.
- Loading regions use `role="status"`/`aria-live="polite"`; error
  regions use `role="alert"`.
- Focus is never suppressed (no `outline: none` anywhere in
  `styles.css`) — the browser's default focus ring remains visible.

## Telegram theme (§38)

`useTelegramTheme()` (see `MINI_APP_ARCHITECTURE.md`) applies real
Telegram colors on top of the existing dark/light CSS defaults, never
replacing them — the app renders correctly in a plain browser (dev mode,
or a future non-Telegram surface) exactly as it did before Section 09.

## What was deliberately not built

- No fake "AI confidence" score, no ranking of selections for visual
  appeal (§15).
- No real-time/aggressive polling (§36) — the risk of masking staleness
  or hammering the backend on financially-sensitive data (execution,
  settlement, risk) outweighs the benefit at this stage; a user
  refreshes via `refetch()`/re-navigation.
- No owner/admin operations console (§55 — explicitly Section 11's
  job); the Account screen shows only the caller's own account.
- No Telegram channel/publishing management (§56 — Section 10's job).

## See also

- [`MINI_APP_ARCHITECTURE.md`](./MINI_APP_ARCHITECTURE.md)
- [`MINI_APP_SECURITY.md`](./MINI_APP_SECURITY.md)
- [`MINI_APP_DATA_CONTRACTS.md`](./MINI_APP_DATA_CONTRACTS.md)
