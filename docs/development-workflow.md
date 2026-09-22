# Development Workflow

## Prerequisites
- Node.js >= 20
- pnpm (`corepack enable` or `npm install -g pnpm`)
- Supabase CLI, for local database/edge functions (optional for pure
  package/UI work)

## Install

```bash
pnpm install
cp .env.example .env   # then fill in local values
```

## Run

```bash
pnpm dev:miniapp   # Vite dev server for apps/miniapp, http://localhost:5173
pnpm dev:bot       # apps/bot in long-polling mode (requires TELEGRAM_BOT_TOKEN)
```

## Local Supabase (required for Telegram authentication end-to-end)

```bash
supabase start
supabase db reset          # applies supabase/migrations/*, then supabase/seed/seed.sql
supabase functions serve   # serves telegram-init-auth, telegram-me, telegram-webhook locally
```

`supabase start` prints a local `anon key`, `service_role key`, and
`JWT secret` — put those in `.env` as `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_JWT_SECRET`. Edge functions read
secrets from `supabase/functions/.env` (or `supabase secrets set ...` for
a deployed project) — set `TELEGRAM_BOT_TOKEN`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_JWT_SECRET` there too.

## Testing the Telegram auth flow locally

Real Telegram Mini App testing requires an HTTPS-reachable URL (Telegram
will not load a Mini App over plain HTTP). Two supported paths:

**A — Real Telegram, via a tunnel**
1. `pnpm dev:miniapp` (serves on `http://localhost:5173`).
2. Expose it over HTTPS with a tunnel, e.g. `cloudflared tunnel --url http://localhost:5173`
   or `ngrok http 5173`. Never hard-code the resulting URL anywhere committed.
3. Set that HTTPS URL as the Mini App URL for your **test** bot via
   [@BotFather](https://t.me/BotFather) (`/newapp` or `/myapps` → Bot Settings → Menu Button / Mini App).
4. Open the bot in Telegram and launch the Mini App. `initData` is now real
   and validated by `telegram-init-auth` against your `TELEGRAM_BOT_TOKEN`.
5. Inspect the request/response in your browser's remote-debugging tools
   (Telegram Desktop supports `View → Developer Tools` for Mini Apps) or in
   `supabase functions serve`'s logs.

**B — Development bypass, no Telegram required**
1. Set `TIPSTAR_DEV_AUTH_BYPASS=true` in `.env` (ignored automatically
   unless `APP_ENV` is not `production` — see
   `docs/architecture/telegram-security.md#development-mode`).
2. `pnpm dev:miniapp`, open `http://localhost:5173` in a plain browser.
3. The Mini App detects it isn't running inside Telegram and shows a
   "Continue as dev user (development only)" button instead of a blank
   screen — click it to get a real session issued by
   `telegram-init-auth`'s dev-bypass path.
4. **Never** set `TIPSTAR_DEV_AUTH_BYPASS=true` for a staging/production
   deployment — the backend ignores it there regardless, but keeping it
   unset/`false` is still the expectation.

## Quality gates

```bash
pnpm typecheck   # strict TypeScript across every package/app
pnpm test        # vitest, run once
pnpm test:watch  # vitest, watch mode
pnpm lint        # eslint
```

## Adding a package

1. `packages/<name>/package.json` — name it `@tipstar/<name>`, add it to
   `pnpm-workspace.yaml` (already globbed via `packages/*`).
2. `packages/<name>/tsconfig.json` — extend `../../tsconfig.base.json`.
3. `src/index.ts` as the only public entry point; internal modules stay
   internal unless re-exported there.
4. Declare real `workspace:*` dependencies for anything you import — don't
   rely on pnpm's hoisting.

## Adding a fifth intelligence agent (e.g. Tennis)

This is the concrete test of the architecture holding up:

1. `packages/sports/src/tennis.ts` — a `TennisProvider` interface
   extending `SportsProvider`, plus `packages/sports/src/mock/mock-tennis-provider.ts`.
2. `packages/intelligence/src/agents/tennis-agent.ts` — extend
   `BaseIntelligenceAgent`, implement `evaluateMock`.
3. Register the new `AgentType` value in `packages/types/src/intelligence.ts`
   and the matching Postgres enum in a **new** migration (never edit the
   Section 01 migration).

Nothing in `packages/decision-engine`, `packages/picks`,
`packages/settlement`, `packages/performance`, or `apps/miniapp` should
need to change.
