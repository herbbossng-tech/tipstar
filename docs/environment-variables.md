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
| `SUPABASE_SERVICE_ROLE_KEY` | production only | **yes** | Bypasses RLS — never import `loadServerConfig()` from `apps/mini-app`. As of Section 03, genuinely used: every Edge Function (`telegram-auth`, `me`, `owner-bootstrap`) and `@sport-os/platform`'s repositories construct their Supabase client with it. |
| `TELEGRAM_BOT_TOKEN` | production only | **yes** | Bot API calls and Mini App initData HMAC validation. |
| `TELEGRAM_WEBHOOK_SECRET` | production only | **yes** | Must match the `secret_token` passed to Telegram's `setWebhook`. |
| `TELEGRAM_INIT_DATA_MAX_AGE_SECONDS` | no (default `86400`) | no | Replay-protection freshness window for Telegram `initData` (Section 02). |
| `TELEGRAM_INIT_DATA_CLOCK_SKEW_SECONDS` | no (default `60`) | no | Tolerance for a slightly-future `auth_date` (client clock drift). |
| `SESSION_SIGNING_SECRET` | production only | **yes** | Signs the stateless auth session token issued after Telegram verification — see `docs/architecture/TELEGRAM_AUTHENTICATION.md`. |
| `SESSION_TOKEN_TTL_SECONDS` | no (default `86400`) | no | How long an issued session token stays valid. |
| `DEV_AUTH_MODE` | no (default `disabled`) | no | Server-side gate for the dev-mode Telegram auth bypass. **Never usable when `APP_ENV=production`** regardless of this value — `loadServerConfig()` refuses to load such a combination at all. |
| `VITE_DEV_AUTH_MODE` | no (default `disabled`) | no | Client-visible mirror of `DEV_AUTH_MODE` — only controls whether the Mini App *shows* a dev-login affordance; it grants no capability on its own, since the server re-verifies `DEV_AUTH_MODE` independently. |
| `OWNER_BOOTSTRAP_SECRET` | no (default: unset) | **yes** | Section 03. One-time OWNER-promotion secret, compared with a timing-safe comparison. Absent by default — bootstrap is then permanently unavailable, a safe fail-closed default, *not* something that must be set. See `docs/architecture/AUTHORIZATION.md`. |
| `FOOTBALL_DATA_PROVIDER`, `FOOTBALL_DATA_API_KEY` | no | key is **yes** | Section 13 — Sportmonks (the canonical football-data provider). See `docs/architecture/FOOTBALL_PROVIDER_INTEGRATION.md`. |
| `FOOTBALL_DATA_ENABLED` | no (default `false`) | no | Section 04/13. Mirrors `ProviderConfig.enabled`. The Sportmonks adapter/ingestion jobs safely no-op while this is `false` — never auto-enabled. |
| `FOOTBALL_DATA_BASE_URL` | no | no | Section 04. Mirrors `ProviderConfig.baseUrl`. |
| `FOOTBALL_DATA_TIMEOUT_MS` | no (default `5000`) | no | Section 04. Mirrors `ProviderConfig.timeoutMs`. |
| `FOOTBALL_DATA_MAX_RETRIES` | no (default `2`) | no | Section 04. Mirrors `ProviderConfig.maxRetries` — bounded, never infinite (`withBoundedRetries()`). |
| `FOOTBALL_DATA_RATE_LIMIT_PER_MINUTE` | no (default: unset) | no | Section 04. Mirrors `ProviderConfig.rateLimitPerMinute`. |
| `FOOTBALL_DATA_POLL_INTERVAL_SECONDS` | no (default: unset) | no | Section 04/13. Mirrors `ProviderConfig.pollIntervalSeconds` — also the worker scheduler's enqueue bucket size for `FOOTBALL_REFERENCE_INGESTION`/`FOOTBALL_FIXTURE_INGESTION`. Unset = those jobs are never enqueued. |
| `FOOTBALL_DATA_COMPETITION_IDS` | no (default: unset) | no | Section 13 — new. Comma-separated Sportmonks league ids to ingest. Unset/empty = nothing selected = ingestion safely no-ops; never a hard-coded permanent league list in code. |
| `ODDS_PROVIDER`, `ODDS_API_KEY` | no | key is **yes** | Section 13 — The Odds API (the canonical odds provider). |
| `ODDS_ENABLED`, `ODDS_BASE_URL`, `ODDS_TIMEOUT_MS`, `ODDS_MAX_RETRIES`, `ODDS_RATE_LIMIT_PER_MINUTE`, `ODDS_POLL_INTERVAL_SECONDS` | no (same defaults as their `FOOTBALL_DATA_*` equivalents) | no | Section 04/13. Same purpose as the `FOOTBALL_DATA_*` provider-config vars above, for the odds provider; `ODDS_POLL_INTERVAL_SECONDS` also gates `FOOTBALL_ODDS_INGESTION` scheduling. |
| `ODDS_SPORT_KEYS` | no (default: unset) | no | Section 13 — new. Comma-separated The Odds API sport keys (e.g. `soccer_epl,soccer_spain_la_liga`) to ingest. Unset/empty = ingestion safely no-ops. |
| `AVIATOR_DATA_PROVIDER`, `AVIATOR_DATA_API_KEY` | no | key is **yes** | Untouched by Section 04 — Aviator data ingestion is not this section's scope. |
| `SPORTYBET_INTEGRATION_MODE` | no (default `disabled`) | no | `manual` \| `assisted` \| `disabled`. Never assume an undocumented public API — see `docs/architecture/OPEN_QUESTIONS.md`. |
| `JOBS_ENABLED` | no (default `false`) | no | Gates the scheduling/background-jobs contract (`@sport-os/platform`'s `JobScheduler`) — no concrete scheduler exists yet. |
| `WORKER_POLL_INTERVAL_MS` | no (default `5000`) | no | Section 12. How often `apps/worker` polls for a claimable job when idle. |
| `WORKER_SCHEDULER_TICK_MS` | no (default `60000`) | no | Section 12. How often `apps/worker` runs its internal scheduler tick (weekly-report + health-check enqueueing). |

**Production fails safe:** `loadServerConfig()` throws `ConfigurationError`
when `APP_ENV=production` and `SUPABASE_SERVICE_ROLE_KEY`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, or `SESSION_SIGNING_SECRET`
is missing, or when `DEV_AUTH_MODE=enabled` — these secrets are optional in
development for easier local setup, but the app refuses to start
misconfigured (or dev-auth-enabled) in production rather than falling back
to an insecure default.

`packages/config`'s `SERVER_ONLY_ENV_KEYS` is the machine-checkable list
of which keys must never reach a browser bundle — treat it as the source
of truth over this table if they ever disagree.

**Browser code must import from `@sport-os/config/client`, never the
package root.** The root barrel re-exports `schema.ts`'s zod `envSchema`,
whose builder-chain calls bundlers can't prove side-effect-free and
therefore won't tree-shake — importing anything from the root (even just
`loadClientConfig`) pulls the entire server env var *schema* (variable
names, not values) into the bundle. `@sport-os/config/client`
(`packages/config/src/client.ts`) only reaches `loadClientConfig` and the
`ClientConfig` type, with zero path to `schema.ts` or zod. Verified by
building `apps/mini-app` with real-looking secret values set and grepping
`dist/assets/*.js` for them — see Section 02's final report.
