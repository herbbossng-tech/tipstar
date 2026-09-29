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

## 4. Where does the real session/auth token live once IdentityService is real? (Resolved — Section 03, revocation half; RLS bridge remains open as #8)

Section 02 answered the stateless-token half. Section 03 answered the
revocation half: a hybrid model — Section 02's token format unchanged,
a new `auth_sessions` table adds real revocation on top. See
`docs/architecture/TELEGRAM_AUTHENTICATION.md`'s "Session architecture
(Section 03 update)" for the full design.

**What's still open** (split out as its own question, since it's a
distinct architectural fork, not a detail of this one): whether/how a
Supabase-Auth-JWT bridge is ever built so RLS becomes reachable from the
live Mini App traffic — see question #8.

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

## 7. Does `SESSION_SIGNING_SECRET`'s stateless design survive first contact with Section 03's persistence? (Resolved — Section 03)

Yes, by construction: the hybrid design (question #4) keeps
`SESSION_SIGNING_SECRET` and the stateless signature check exactly as
Section 02 built them — the persistence layer added in Section 03
(`auth_sessions`) is additive, not a replacement. No config var was
removed or repurposed.

## 8. Will this codebase ever bridge Telegram identity into a Supabase Auth JWT, so RLS is reachable from live traffic?

Section 03's RLS policies (`users`/`licenses`/etc.) are real, tested
(`tests/database/`), and correct — but **unreachable from any live code
path today**, because nothing mints a Supabase-Auth-compatible JWT for a
Telegram-authenticated user. `auth.uid()` is always `NULL` on the
`authenticated` role today; every actual Mini App request instead goes
through a service-role-mediated Edge Function, with authorization
enforced in application code (`@sport-os/platform`'s guards) — see
`docs/architecture/DATABASE_AND_RLS.md`'s "RLS identity helper".

This works and is secure today, but it means the database's own RLS
layer is currently more of a second, independently-verified copy of the
same rules than a live control. Two ways to close that gap exist and
neither has been chosen:
- **A.** Adopt Supabase Auth properly (create real `auth.users` rows
  linked to `public.users`, mint sessions through Supabase's own auth
  flow) — the "supported" path, but a real architectural commitment this
  section wasn't asked to make ("do not pretend Telegram users are
  automatically Supabase Auth users").
- **B.** Mint a custom JWT signed with the project's JWT secret, carrying
  `sub = users.id`, issued alongside (or instead of) the Section 02/03
  session token — narrower in scope than (A), but is exactly the "weak
  bridge" the spec explicitly warned against inventing casually.

Whoever picks this up needs to decide deliberately, with the trade-offs
above in view, not have it implied by whatever's easiest to wire up at
the time.

## 9. Are `licenses.max_devices` / device-session limits ever going to be enforced, and how?

`auth_sessions` gives Section 04+ everything needed to count a user's
active (non-revoked) sessions, but nothing enforces `max_devices` today
— device fingerprinting was explicitly ruled out
("do not fake device fingerprinting"), and a session-count-based
definition of "device" is a real, buildable, but unmade product
decision. See `TELEGRAM_AUTHENTICATION.md`'s "Device limit foundation".

## 10. When does the owner/admin dashboard UI get built?

Section 03 was explicitly told not to build one ("Do not build the full
owner dashboard in Section 03... UI administration belongs primarily to
later sections") — the backend authorization foundation
(`user-admin.ts`, `license.ts`'s admin operations, the authorization
matrix in `AUTHORIZATION.md`) is real and ready for one, but no UI
consumes it yet, and no section has been assigned to build it.
