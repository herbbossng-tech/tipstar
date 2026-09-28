# Environment Variables

Copy `.env.example` to `.env` for local development. Validation and typed
access live in `packages/config` (`loadServerConfig()` / `loadClientConfig()`).

| Variable | Required | Server-only | Notes |
|---|---|---|---|
| `APP_ENV` | no (default `development`) | no | `development` \| `staging` \| `production`. |
| `APP_NAME`, `APP_VERSION`, `LOG_LEVEL` | no (defaulted) | no | |
| `VITE_APP_NAME`, `VITE_API_BASE_URL` | yes (Mini App) | no | Vite only exposes `VITE_`-prefixed vars to the client — this is the entire client-safe surface. |
| `SUPABASE_URL` | yes | no | Safe for the Mini App bundle. |
| `SUPABASE_ANON_KEY` | yes | no | Safe for the Mini App bundle. |
| `SUPABASE_SERVICE_ROLE_KEY` | production only | **yes** | Bypasses RLS — never import `loadServerConfig()` from `apps/mini-app`. |
| `TELEGRAM_BOT_TOKEN` | production only | **yes** | Bot API calls and Mini App initData HMAC validation. |
| `TELEGRAM_WEBHOOK_SECRET` | production only | **yes** | Must match the `secret_token` passed to Telegram's `setWebhook`. |
| `FOOTBALL_DATA_PROVIDER`, `FOOTBALL_DATA_API_KEY` | no | key is **yes** | Provider not selected/integrated yet (Section 01). |
| `ODDS_PROVIDER`, `ODDS_API_KEY` | no | key is **yes** | |
| `AVIATOR_DATA_PROVIDER`, `AVIATOR_DATA_API_KEY` | no | key is **yes** | |
| `SPORTYBET_INTEGRATION_MODE` | no (default `disabled`) | no | `manual` \| `assisted` \| `disabled`. Never assume an undocumented public API — see `docs/architecture/OPEN_QUESTIONS.md`. |
| `JOBS_ENABLED` | no (default `false`) | no | Gates the scheduling/background-jobs contract (`@sport-os/platform`'s `JobScheduler`) — no concrete scheduler exists yet. |

**Production fails safe:** `loadServerConfig()` throws `ConfigurationError`
when `APP_ENV=production` and `SUPABASE_SERVICE_ROLE_KEY`,
`TELEGRAM_BOT_TOKEN`, or `TELEGRAM_WEBHOOK_SECRET` is missing — these are
optional in development for easier local setup, but the app refuses to
start misconfigured in production rather than falling back to an
insecure default.

`packages/config`'s `SERVER_ONLY_ENV_KEYS` is the machine-checkable list
of which keys must never reach a browser bundle — treat it as the source
of truth over this table if they ever disagree.
