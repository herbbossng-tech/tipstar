# ADR 0004: Hand-rolled HS256 session token, signed with Supabase's own JWT secret

## Status
Accepted (Section 02)

## Context
ADR 0002 fixed the RLS contract: policies key off `tipstar_auth_user_id()`,
which reads a `tipstar_user_id` claim out of `request.jwt.claims`, but
deferred *how* that claim gets onto a real request to "Section 02+". This
section has to pick a concrete mechanism.

Supabase's built-in email/OAuth Auth (GoTrue) was already rejected in ADR
0002 — Tipstar's identity is Telegram, not a second auth system. What
remained open was how to get a JWT that (a) PostgREST accepts as
`role: authenticated`, and (b) carries `tipstar_user_id`, without adopting
GoTrue.

## Decision
- After `validateInitData()` succeeds and `upsert_telegram_user()` resolves
  the internal user, `supabase/functions/telegram-init-auth` issues a
  compact HS256 JWT (`packages/session/src/jwt.ts`, mirrored for Deno)
  containing `{ sub, role: "authenticated", tipstar_user_id,
  telegram_user_id, iat, exp }`, signed with `SUPABASE_JWT_SECRET` — the
  **same legacy project JWT secret** PostgREST already validates incoming
  bearer tokens against for the `anon`/`service_role` keys themselves.
  Because the signature matches, PostgREST treats this token exactly like
  a GoTrue-issued one and exposes its claims via `request.jwt.claims` —
  `tipstar_auth_user_id()` needs no changes at all.
- The client keeps this token in `sessionStorage` and sends it as
  `Authorization: Bearer <token>` on every subsequent call.
  `supabase/functions/telegram-me` demonstrates the intended shape for any
  future authenticated Edge Function: verify the token locally first (fast
  401 on a bad/expired token), then create the Supabase client **using
  that token**, not the service role, so the query goes through RLS like
  any other authenticated client request.
- Session lifetime is a config value (`SESSION_TOKEN_TTL_SECONDS`, default
  6h) rather than infinite — a reasonable middle ground for a Mini App
  that's typically reopened from Telegram often, without requiring a
  refresh-token flow in this section.

## Alternatives considered
- **Adopt Supabase Auth's custom/third-party JWT provider feature.**
  Rejected for this section: it requires project-level configuration this
  ADR shouldn't presume access to, and the hand-rolled approach already
  satisfies the same contract (`tipstar_user_id` claim, `authenticated`
  role) that ADR 0002 fixed, with a migration path to that feature later
  if needed — nothing about RLS policies would need to change either way.
- **Have the backend always use the service-role key and enforce
  authorization entirely in application code.** Rejected as the default:
  it would make every future endpoint responsible for re-deriving "is this
  the caller's own row", exactly the class of bug RLS exists to rule out
  by construction. Service-role is used only where it must be (the
  `upsert_telegram_user` write), never for reads a user could do for
  themselves.
- **Store the session token in `localStorage`.** Rejected — Section 6
  explicitly asks not to store credentials there without need;
  `sessionStorage` bounds exposure to the current WebView tab lifetime for
  a negligible UX cost (Telegram Mini Apps are typically re-launched from
  the chat, not restored from a dormant tab).

## Consequences
- Rotating `SUPABASE_JWT_SECRET` invalidates every outstanding Tipstar
  session immediately (same as it would for GoTrue-issued tokens) — this
  is a feature (fast global revocation), not a bug, but operationally it
  means rotating that secret is a "log everyone out" event.
- If Tipstar later moves to Supabase's official third-party JWT support or
  a different token issuer entirely, only `packages/session` and the two
  Edge Functions that call it change — RLS policies and every downstream
  consumer of `tipstar_auth_user_id()` are unaffected, exactly as ADR 0002
  intended.
