# Deployment

Section 01 establishes only the deployment-adjacent foundation — there is
no production deployment yet (no schema, no real intelligence engines, no
real Telegram destinations configured). This document records what
exists today and what a later section needs to add.

## What exists today

- **Mini App** (`apps/mini-app`): a standard Vite React build
  (`npm run build --workspace=apps/mini-app`) producing static assets —
  deployable to any static host once there's a real backend for it to
  call.
- **Bot** (`apps/bot`): a Node process. Runs in long-polling mode
  locally (no `TELEGRAM_WEBHOOK_SECRET` set) or webhook mode in
  production (`node apps/bot/dist/index.js` after `npm run build
  --workspace=apps/bot`, behind an HTTPS endpoint Telegram can reach,
  with `TELEGRAM_WEBHOOK_SECRET` set and registered via Telegram's
  `setWebhook`).
- **`supabase/functions/health`**: deployable via `supabase functions
  deploy health`. The only Supabase Edge Function that exists — no
  authentication or business-logic functions exist yet.

## Environment separation

`APP_ENV` (`development` | `staging` | `production`) must be set
correctly per deployment target — `loadServerConfig()` enforces stricter
required secrets in `production` (see
`docs/environment-variables.md`). Test/staging bot tokens and Telegram
destinations must never be reused in production, and vice versa.

## What later sections must add before a real deployment

- A Supabase project with a real schema and RLS policies (Section 03).
- Real secrets management for `TELEGRAM_BOT_TOKEN`,
  `SUPABASE_SERVICE_ROLE_KEY`, and `TELEGRAM_WEBHOOK_SECRET` (a secrets
  manager or the hosting platform's own secret store — never committed).
- A CI pipeline running `npm run check` (typecheck + lint + test) and
  `npm run build` before any deploy.
- A concrete `JobScheduler` implementation, gated by `JOBS_ENABLED`, once
  real background jobs (settlement polling, weekly reports, daily risk
  resets) exist to run.
