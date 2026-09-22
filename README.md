# Tipstar

Tipstar is a sports intelligence and betting companion platform delivered
primarily through a Telegram Mini App, supported by a Telegram Bot/Channel
and a Supabase-powered backend.

This repository is built progressively across 12 sections.

- **Section 01 — Product Foundation & Engineering Architecture**: a
  strict-TypeScript monorepo with the domain packages, Telegram security
  foundation, database schema, and architectural boundaries every later
  section extends.
- **Section 02 — Telegram Identity & Mini App Core**: server-side
  Telegram `initData` validation is wired end to end into a real
  authentication flow (idempotent user upsert, a signed session token
  PostgREST/RLS accept, a `GET current user` endpoint enforced through
  RLS), and the Mini App gained its real shell — Telegram SDK
  abstraction, theme/viewport handling, routing, bottom navigation, and
  Loading/Empty/Error states across every foundation screen. See
  `docs/architecture/telegram-security.md`.

## Repository layout

```
apps/
  miniapp/     Telegram Mini App (React + Vite + TypeScript)
  bot/         Telegram Bot (grammy)
packages/
  shared/          Result type, error model, id generation, logger contract
  types/           Shared domain types (user, sports, intelligence, picks, entitlements, audit)
  config/          Environment schema & typed config loader (zod)
  telegram/        initData validation, webhook verification, session boundary
  session/         Session token issuance/verification (Section 02)
  sports/          SportsProvider interfaces per domain + mock (dev-only) adapters
  intelligence/    IntelligenceAgent contract + Football/Basketball/Virtual Football/Aviator agents
  decision-engine/ Common publication Decision Engine
  picks/           Immutable Pick Engine with audited corrections
  settlement/      Idempotent Settlement Engine
  performance/     Performance statistics derived from settled picks
  entitlements/    Subscriptions, affiliate attribution, RBAC roles
  notifications/   NotificationProvider abstraction + idempotent dispatch
  audit/           Structured logging + audit log with secret redaction
supabase/
  migrations/      PostgreSQL schema (RLS, triggers, enums)
  functions/       Deno edge functions (Telegram initData auth, webhook)
  seed/            Development-only seed data
docs/
  architecture/    How the system fits together and why
  decisions/       ADRs
  api/             API surface notes
tests/             Cross-package idempotency test
```

See [`docs/architecture/overview.md`](./docs/architecture/overview.md) for
the full architecture, [`docs/development-workflow.md`](./docs/development-workflow.md)
for local setup, and [`docs/environment-variables.md`](./docs/environment-variables.md)
for configuration.

## Quick start

```bash
pnpm install
cp .env.example .env   # fill in local values
pnpm typecheck
pnpm test
pnpm dev:miniapp        # http://localhost:5173
```

## Engineering principles (non-negotiable)

- Strict TypeScript everywhere; no unnecessary `any`.
- No secrets committed; server-only keys never reach the Mini App bundle.
- Telegram identity is trusted only after server-side `initData` HMAC
  validation — never from a client-asserted user id.
- Sports/payment/affiliate/notification vendors are abstracted behind
  provider interfaces; no vendor-specific logic in the core app.
- No fabricated data: a field a provider doesn't supply is `null`, never
  invented.
- No fake prediction logic: agents without a real model honestly report
  `INSUFFICIENT_DATA`; mock results are always flagged `isMock: true`.
- Published picks are immutable except through an audited correction
  trail; losses and voids are never hidden from performance statistics.
- Settlement and notification dispatch are idempotent.

Full rules: see the product brief's Engineering Constitution, reflected
throughout `docs/architecture/`.
