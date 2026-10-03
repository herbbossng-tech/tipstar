# Mini App Architecture (Section 09)

The Telegram Mini App is a **presentation and interaction layer** — a
command center for the intelligence and money-relevant state the backend
already computed in Sections 01-08. It is never itself the licensing
authority, the authentication authority, the prediction engine, the
value engine, the decision engine, the risk authority, the settlement
engine, the financial ledger, or the execution authority. Every number
this app renders was computed server-side; nothing here recomputes
probability, EV, fair odds, risk approval, or a financial figure.

## The locked flow

```
TELEGRAM → TELEGRAM AUTH → SESSION → BACKEND API / EDGE FUNCTIONS
  → AUTHORIZED DOMAIN SERVICES → DATABASE / AGENTS / ENGINES
  → TYPED RESPONSE → MINI APP UI
```

Never `UI → direct database mutation`, never `UI → prediction
calculation`, never `UI → risk bypass`, never `UI → execution adapter`.
This holds by construction: the Mini App bundle has no Supabase client,
no database credentials, and no import of any server-side engine package
(`football-engine`, `settlement-engine`, `risk-engine`, etc.) — see
`MINI_APP_SECURITY.md`.

## What Section 09 built

- **5 new read-only Supabase Edge Functions** (`supabase/functions/
  football-fixtures`, `football-fixture-detail`, `tickets`,
  `ticket-detail`, `performance-summary`) — see
  [`MINI_APP_DATA_CONTRACTS.md`](./MINI_APP_DATA_CONTRACTS.md).
- **A typed API client layer** (`apps/mini-app/src/api/*`,
  `services/api.ts`'s `authedGet`) — every domain call goes through one
  centralized `apiRequest`, never a raw `fetch()` in a component (enforced
  by `security.test.ts`).
- **A shared component library** (`apps/mini-app/src/shared/*`) —
  `StatusBadge`, `EmptyState`, `QueryErrorState`, `LoadingState`,
  `LicenseCard`, `FixtureCard`, `ValueCard`, `DecisionBadge`, `TicketCard`,
  `TicketLegRow`, `PerformanceMetric`, plus two pure logic modules
  (`statusPresentation.ts`, `format.ts`) every component and every test
  shares.
- **Six screens**: Home, Football (+ fixture detail), Tickets (+ ticket
  detail), Aviator, Performance, Account — replacing Section 01's
  structural placeholders.
- **`useQuery`** (`apps/mini-app/src/hooks/useQuery.ts`) — the one data-
  fetching primitive every screen uses: loading/error/success states,
  generation-counter race protection, and `refetch()`.
- **Telegram theme integration** (`telegram/useTelegramTheme.ts`) — real
  `colorScheme`/`themeParams` applied as CSS custom properties, with the
  existing `prefers-color-scheme` fallback preserved for outside-Telegram
  use.

## Package/app boundary

Nothing moved. `apps/mini-app` remains the only consumer of these new
edge functions; no server-side package gained a dependency on it, and
`apps/mini-app` gained no new dependency on any server-side package. The
five new edge functions live in `supabase/functions/`, exactly where
`telegram-auth`/`me`/`owner-bootstrap`/`health` already do, following
their exact established pattern (Deno runtime, service-role Supabase
client, session verification via `../_shared/session.ts`).

## Component architecture

Presentation-only, as the spec requires — no component computes a
domain value. Two pure, dependency-free logic modules back every visual
component:

- **`shared/statusPresentation.ts`** — one `describe*()` function per
  backend enum (`ExecutionStatus`, `SettlementStatus`, `TicketStatus`,
  `DecisionOutcome`, risk approval, `MatchStatus`, `LicenseStatus`),
  each returning `{label, tone}`. No default/catch-all silently
  relabels an unrecognized value as something reassuring — an unknown
  status renders its own raw value.
- **`shared/format.ts`** — `formatMoney` (never converts `null` into
  "0"), `formatPercent`/`formatSignedPercent`/`formatProbability`,
  `formatOdds`, `formatDateTime`/`formatDate`, `minutesSince` (staleness
  foundation), `formatMarketLabel`.

`StatusBadge` is the single status-rendering primitive (icon + text,
never color alone — see `MINI_APP_UX.md`); every other status-shaped
component (`DecisionBadge`, the settlement/execution/risk displays in
`TicketDetailPage`) is a thin wrapper around it.

## Routing

```
/                    HomePage
/football            FootballPage
/football/:fixtureId FixtureDetailPage
/tickets             TicketsPage
/tickets/:ticketId   TicketDetailPage
/aviator             AviatorPage
/performance         PerformancePage
/account             AccountPage
```

Matches the spec's suggested route list exactly (§42), combining
"Account / License" and "Settings / System state" into one `/account`
screen per §4's "where appropriate." No route bypasses authorization —
every page's data comes from a call that independently re-verifies
session + license + entitlement server-side (see `MINI_APP_SECURITY.md`).

## State management

React state/context only — `AuthIdentityContext` (Section 02/03,
unchanged) for the authenticated identity/session, `useQuery` for all
server data, local `useState` for UI-only concerns (date picker value,
status filter, ledger-mode tab). No Redux/Zustand/global store was
introduced — nothing in this section needed one (§43).

## Data fetching

`useQuery(fetcher, deps)` is the one fetching primitive:

- Loading → success/error, exposed as a discriminated union.
- A monotonically increasing generation counter discards a stale
  response if `deps` change before the in-flight call resolves — a
  second, faster-resolving call can never be clobbered by a first,
  slower one landing late (proven by `useQuery.test.tsx`'s race-
  condition test).
- `refetch()` re-runs the same fetcher on demand.

No page fetches the same resource from more than one place — a page
composed of several independent cards (Home) gives each card its own
`useQuery` call so one card's loading state never blocks another's
(§35), and no polling loop exists anywhere (§36 — nothing in this build
needs real-time updates urgently enough to justify one; a user pulls to
refresh via `refetch()`/re-navigation instead).

## Telegram integration

- `TelegramWebAppClient` (Section 01/02, extended) now also exposes
  `getColorScheme()`/`getThemeParams()` — both `undefined`/`{}` outside
  Telegram, never a guessed value.
- `useTelegramTheme()` applies only the theme properties Telegram
  actually supplied, as CSS custom properties, on top of `styles.css`'s
  own `prefers-color-scheme` defaults — the app is never unreadable
  outside Telegram (§38).
- `BackButton`/`MainButton`/haptic feedback were deliberately NOT wired
  — no write action exists yet for them to drive (see
  `MINI_APP_DATA_CONTRACTS.md`'s "What was not built"), and adding
  unused bindings would be speculative. A future write action (e.g. a
  real assisted-execution confirmation) is the natural place to add
  `MainButton` wiring.
- Safe-area handling uses plain CSS `env(safe-area-inset-*)` (works
  identically inside and outside Telegram) rather than a Telegram-
  specific viewport API.

## See also

- [`MINI_APP_SECURITY.md`](./MINI_APP_SECURITY.md)
- [`MINI_APP_DATA_CONTRACTS.md`](./MINI_APP_DATA_CONTRACTS.md)
- [`MINI_APP_UX.md`](./MINI_APP_UX.md)
- [`TELEGRAM_AUTHENTICATION.md`](./TELEGRAM_AUTHENTICATION.md) — the
  unchanged Section 02/03 authentication flow this app builds on.
