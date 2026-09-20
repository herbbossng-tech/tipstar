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

## Local Supabase (optional, for database/edge-function work)

```bash
supabase start
supabase db reset          # applies supabase/migrations/*, then supabase/seed/seed.sql
supabase functions serve
```

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
