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

## 4. Where does the real session/auth token live once IdentityService is real? (Partially resolved — Section 02)

Section 02 answered the immediate half of this: `packages/telegram`'s
`issueAuthSession()`/`verifyAuthSession()` issue a stateless, HMAC-signed
token after a real `validateInitData()` check — no persistence, no
revocation before natural expiry. See
`docs/architecture/TELEGRAM_AUTHENTICATION.md`'s "Session architecture"
for the full rationale and the `SESSION_SIGNING_SECRET` addition this
required.

**Still open:** whether this stays the permanent design, or Section 03
replaces it with something that can bridge into Supabase RLS (a custom
JWT signed to satisfy `auth.uid()` / `auth.jwt()` in row-level security
policies, Supabase's native auth tables, or a real revocable session
store keyed by `IdentityService`'s eventual persisted user id). This
matters once any table needs RLS scoped to "the current authenticated
user" — a stateless token with no server-side record can't support
"revoke this user's access right now," only "wait for their token to
expire."

## 5. `packages/config` and `packages/platform` are additions beyond the blueprint's 8 named packages

Documented as a deliberate physical-arrangement decision, not a
architecture change, in `docs/architecture/ARCHITECTURE.md`'s "Why two
packages beyond the eight the blueprint named". Flagged here in case the
architect disagrees with the grouping (e.g. would prefer Audit/Health
live inside `agent-core`, or Identity/License get their own packages).

## 6. Is a distributed rate limiter required before Section 02's auth endpoint goes live?

`supabase/functions/telegram-auth`'s rate limiting is a single-isolate,
in-memory fixed window — real defense-in-depth, but not a real control
under concurrent/cold Edge Function isolates, which don't share memory.
Whether this needs a shared backing store (Redis, Supabase table-backed
counter, or Supabase's own platform-level rate limiting if any exists) is
unresolved; it wasn't addressed because no production deployment target
was specified for Section 02. Needs a decision before this endpoint is
exposed to real traffic.

## 7. Does `SESSION_SIGNING_SECRET`'s stateless design survive first contact with Section 03's persistence?

See question #4's "Still open" — flagged again here because it is a
real architectural fork, not just an implementation detail: sessions
either stay stateless (simple, no DB dependency, but not revocable) or
move to a persistent store (revocable, but couples authentication to
whatever Section 03 designs for the database). Whoever designs Section 03
needs to make this call explicitly rather than it being implied by
whatever's easiest at the time.
