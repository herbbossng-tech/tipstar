# Open Questions

Genuine, unresolved architectural questions only — see Section 01's rule:
"If you discover a genuine architectural conflict: STOP before changing
the architecture. Document the conflict here. Do not silently resolve
it." Nothing here is decided; each is a real ambiguity a later section
(or a direct answer from the architect) needs to resolve before the
dependent work can be built for real.

## 1. What does "double bet" mean for Aviator?

The Master Blueprint V1.0 excerpt available to this section names a
"double bet" boundary in the Aviator Engine without defining it. At least
two plausible readings exist:
- Two concurrent stakes on the same round at different cash-out targets
  (a spread strategy).
- A martingale-style stake progression across rounds (doubling after a
  loss).

`packages/aviator-engine/src/double-bet.ts` fixes only that a strategy
decision of this shape exists (`DoubleBetPlan`/`DoubleBetStrategy`); no
strategy logic is implemented, and the type intentionally doesn't commit
to either reading yet.

## 2. What are the real SportyBet integration modes?

`SPORTYBET_INTEGRATION_MODE` is scaffolded with three placeholder values
(`manual` | `assisted` | `disabled`) since Section 01 must not assume
SportyBet exposes an undocumented public API (locked rule #7) and must
not implement any CAPTCHA/anti-bot bypass (locked rule #8). The actual
semantics of `manual` vs `assisted` — what a human operator is expected
to do, and what (if anything) the system may automate around that — need
a product decision before the Football/Aviator Automation Agents can be
scoped.

## 3. Does the Mini App's `dashboard` module require access outside Telegram?

The Mini App's `apps/mini-app/src/dashboard` placeholder, plus the
product definition's Telegram-Mini-App-first framing, suggests Telegram
`initData` is the sole identity mechanism. But "dashboard" as a name
sometimes implies broader web access (e.g. a desktop admin view). If a
non-Telegram web login is ever required, `IdentityService` needs a second
resolution path beyond `resolve(telegramUserId)` — worth confirming
before Section 03 designs the identity schema.

## 4. Where does the real session/auth token live once IdentityService is real?

Section 01 established `packages/telegram`'s real `validateInitData()`
but deliberately does not issue any session token — `AuthBoundary` in
`apps/mini-app` resolves to `ready` immediately with no real check. The
mechanism for turning a validated Telegram user into an authenticated
session (custom JWT bridging into Supabase RLS, Supabase's native auth,
or something else) is a Section 03 decision, not resolved here.

## 5. `packages/config` and `packages/platform` are additions beyond the blueprint's 8 named packages

Documented as a deliberate physical-arrangement decision, not a
architecture change, in `docs/architecture/ARCHITECTURE.md`'s "Why two
packages beyond the eight the blueprint named". Flagged here in case the
architect disagrees with the grouping (e.g. would prefer Audit/Health
live inside `agent-core`, or Identity/License get their own packages).
