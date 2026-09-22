# Environment Variables

Copy `.env.example` to `.env` for local development. Validation and typed
access live in `packages/config` (`loadServerConfig()` / `loadClientConfig()`).

| Variable | Required | Server-only | Notes |
|---|---|---|---|
| `NODE_ENV`, `APP_ENV`, `LOG_LEVEL` | no (defaulted) | no | |
| `SUPABASE_URL` | yes | no | Safe for the Mini App bundle. |
| `SUPABASE_ANON_KEY` | yes | no | Safe for the Mini App bundle. |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | **yes** | Bypasses RLS — never import `loadServerConfig()` from `apps/miniapp`. |
| `SUPABASE_JWT_SECRET` | for auth endpoints | **yes** | Signs/verifies Tipstar session tokens (`@tipstar/session`); must be the Supabase project's own JWT secret so PostgREST/RLS accept the token. |
| `TELEGRAM_BOT_TOKEN` | for bot/edge functions | **yes** | Used for initData HMAC validation and Bot API calls. |
| `TELEGRAM_BOT_USERNAME` | for bot | no | |
| `TELEGRAM_WEBHOOK_SECRET` | for webhook mode | **yes** | Must match the `secret_token` passed to Telegram's `setWebhook`. |
| `TELEGRAM_MINIAPP_URL` | for bot's `/start` | no | The Mini App's public URL, registered with @BotFather. |
| `TELEGRAM_CHANNEL_ID` | later section | no | Public channel used for distribution. |
| `TELEGRAM_INITDATA_MAX_AGE_SECONDS` | no (defaulted 86400) | no | Replay-protection window. |
| `TELEGRAM_ENVIRONMENT` | no | no | `development` \| `staging` \| `production` — which Telegram bot/Mini App config is in use. |
| `SESSION_TOKEN_TTL_SECONDS` | no (defaulted 21600) | no | Application session token lifetime, in seconds. |
| `TIPSTAR_DEV_AUTH_BYPASS` | no (defaulted `false`) | no | **Development only.** Ignored outside `APP_ENV !== "production"`. See `docs/architecture/telegram-security.md`. |
| `API_BASE_URL` | yes | no | |
| `SPORTS_PROVIDER`, `SPORTS_PROVIDER_API_KEY`, `SPORTS_PROVIDER_BASE_URL` | no (`mock` default) | key is **yes** | Selects/authenticates the `SportsProvider` adapter. |
| `ODDS_PROVIDER`, `ODDS_PROVIDER_API_KEY` | no (`mock` default) | key is **yes** | |
| `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL` | later section | key is **yes** | Explanation layer only — see `docs/architecture/overview.md`. |
| `PAYMENT_PROVIDER`, `PAYMENT_PROVIDER_API_KEY`, `PAYMENT_PROVIDER_WEBHOOK_SECRET` | no (`mock` default) | keys are **yes** | |
| `AFFILIATE_PROVIDER`, `AFFILIATE_PROVIDER_API_KEY` | no (`mock` default) | key is **yes** | |
| `NOTIFICATION_PROVIDER` | no (`telegram` default) | no | |

`packages/config`'s `SERVER_ONLY_ENV_KEYS` is the machine-checkable list of
which keys must never reach a browser bundle — treat it as the source of
truth over this table if they ever disagree.
