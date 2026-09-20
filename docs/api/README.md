# API Surface (Section 01 boundary)

No HTTP API is implemented yet — Section 01 ships the domain packages
(`packages/*`) an API layer will sit on top of, plus two Supabase Edge
Functions that already speak real HTTP:

| Endpoint | Runtime | Purpose |
|---|---|---|
| `POST /telegram-init-auth` | Supabase Edge Function (Deno), `supabase/functions/telegram-init-auth` | Validates a Mini App `initData` payload; returns `{ valid, user, authDate }` or 401. |
| `POST /telegram-webhook` | Supabase Edge Function (Deno), `supabase/functions/telegram-webhook` | Verifies the Telegram webhook secret header and acknowledges bot updates. |
| `POST /telegram/webhook` | `apps/bot` (Node, grammy) | Local/self-hosted alternative to the edge function above, for development via long polling or a self-managed webhook. |

A general-purpose REST/RPC API (picks feed, performance stats, account
management) is intentionally out of scope for Section 01 (see product
brief Section 32, scope control) — it will be built in a later section on
top of `packages/picks`, `packages/performance`, and `packages/entitlements`,
most likely as additional Supabase Edge Functions or a small server that
imports those packages directly (they have no HTTP-framework dependency,
by design).
