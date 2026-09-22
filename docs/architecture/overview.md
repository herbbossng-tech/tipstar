# Tipstar Architecture Overview

Tipstar is a sports intelligence and betting companion platform delivered
through a Telegram Mini App, a Telegram Bot/Channel, and a Supabase-powered
backend. This document is the map of the system established in Section 01;
every later section extends it rather than replacing it.

## High-level architecture

```
TIPSTAR
│
├── apps/miniapp        Telegram Mini App (React + Vite + TS) — Section 02 core
├── apps/bot             Telegram Bot (grammy, Node)
├── supabase/functions   Telegram auth/webhook/channel edge functions
├── supabase/migrations  Core Backend schema (PostgreSQL)
│
├── packages/sports          Sports Data Layer (provider abstraction)
├── packages/intelligence    Intelligence Layer
│   ├── FootballAgent
│   ├── BasketballAgent
│   ├── VirtualFootballAgent
│   └── AviatorAgent
├── packages/decision-engine  Common Decision Engine
├── packages/picks            Pick Engine
├── packages/settlement        Settlement Engine
├── packages/performance        Performance Engine
├── packages/entitlements       Subscription / Affiliate / RBAC
├── packages/notifications      Notification System
├── packages/audit               Audit & structured logging
├── packages/telegram             Telegram initData/webhook validation
├── packages/session                Session token issuance/verification (Section 02)
├── packages/config                 Environment configuration
└── packages/types, packages/shared   Shared domain types & utilities
```

## Why a monorepo of small packages

Each engine/layer is its own workspace package with an explicit public
surface (`src/index.ts`). This is what makes the "modular agents" and
"common Decision Engine" requirements real rather than aspirational:

- `packages/intelligence` depends on `packages/sports` and `packages/types`,
  never the other way around — the UI and Decision Engine never import an
  agent's internals directly.
- `packages/decision-engine` depends only on `packages/types`. It has no
  idea Football, Basketball, Virtual Football, or Aviator exist — it only
  knows the `IntelligenceResult` shape. Adding a fifth agent (Tennis,
  MMA, esports, ...) never requires touching this package.
- `packages/picks` and `packages/settlement` depend on `packages/types`
  and `@tipstar/shared` only, and take a repository interface rather than a
  concrete database client — a Supabase-backed repository implementation
  is a small adapter, not a rewrite.

## Data flow (evidence-first)

```
RAW DATA (SportsProvider)
   ↓
NORMALIZATION (@tipstar/types domain shapes)
   ↓
FEATURE ENGINEERING (inside each IntelligenceAgent)
   ↓
MODEL / STATISTICAL ANALYSIS (inside each IntelligenceAgent)
   ↓
EVIDENCE PACKAGE (IntelligenceResult.evidence)
   ↓
DECISION ENGINE (packages/decision-engine → DecisionOutcome)
   ↓
PICK ENGINE (packages/picks → immutable Pick, only if QUALIFIED)
   ↓
OPTIONAL LLM EXPLANATION (a later section — never a fact source)
   ↓
USER (apps/miniapp)
```

An LLM is never the source of a probability, injury report, odds line, or
historical result. It may only explain a `Pick`/`IntelligenceResult`
already produced by this pipeline.

## Section 01 boundaries (see docs/decisions for the "why")

- No agent in `packages/intelligence` ships a real statistical model yet.
  In `production` mode every agent honestly returns
  `IntelligenceResultStatus.INSUFFICIENT_DATA`. A `mock` mode exists purely
  for development/testing and always sets `isMock: true`.
- `packages/sports` ships only mock provider adapters, clearly marked
  development-only, returning `null` for anything a real vendor might not
  supply — never fabricated data.
- The Aviator Agent never encodes a fixed win-rate target. Any target rate
  belongs to a later section's backtesting work, evaluated against real
  history, not hard-coded here.

## Section 02: Telegram identity & Mini App core

Section 02 closes the "Section 01 boundary" ADR 0002 left open (session/JWT
issuance) and builds the Mini App shell on top of it:

- `apps/miniapp` gained a `TelegramProvider`/`useTelegram()` abstraction
  (SDK init, theme/viewport binding, Back/Main Button, haptics), an
  `AuthProvider`/`useAuth()` session layer, a typed API client, reusable
  Loading/Empty/Error states, and routed pages for Home/Picks/Matches/
  Performance/Account — all still foundation-only, no fabricated product
  data (Section 41, permanent).
- `packages/session` issues/verifies the Tipstar session token; see
  [`telegram-security.md`](./telegram-security.md) for the full flow.
- `supabase/functions/telegram-init-auth` now performs the complete
  validate → upsert → issue-session flow; `supabase/functions/telegram-me`
  is new (`GET current user`, enforced through RLS, not a service-role
  bypass).

See also:
- [`telegram-security.md`](./telegram-security.md)
- [`intelligence-agents.md`](./intelligence-agents.md)
- [`decision-engine.md`](./decision-engine.md)
- [`database.md`](./database.md)
