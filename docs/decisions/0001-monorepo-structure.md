# ADR 0001: pnpm workspace monorepo with one package per engine/layer

## Status
Accepted (Section 01)

## Context
Tipstar's product brief requires four independent intelligence agents, a
single common Decision Engine, and several other engines (Pick, Settlement,
Performance, Entitlements, Notifications, Audit) that must remain
decoupled from each other and from any specific UI or vendor. The whole
product is built progressively across 12 sections by (potentially)
different working sessions, so package boundaries need to be legible and
hard to accidentally violate.

## Decision
Use a single Git repository with pnpm workspaces (`pnpm-workspace.yaml`):
`apps/*` for runnable applications (`miniapp`, `bot`), `packages/*` for
one package per bounded concern. Each package has its own `package.json`,
`tsconfig.json` (extending a shared `tsconfig.base.json` with strict mode
enabled), and a single `src/index.ts` public surface. Dependencies between
packages are explicit `workspace:*` dependencies — there is no implicit
cross-package importing outside the declared dependency graph.

Chosen dependency direction (never inverted):

```
shared, types  →  config, telegram, sports  →  intelligence  →  decision-engine  →  picks, settlement  →  performance
                                                                                    entitlements, notifications, audit (peers, depend only on shared/types)
```

## Alternatives considered
- **A single `src/` with folders instead of packages.** Rejected: nothing
  would stop a future change from importing an agent's internals directly
  into a UI component or the Decision Engine, which is exactly what
  Constitution rule R forbids. Package boundaries make that a type/module
  resolution error instead of a code review catch.
- **Separate repositories per app/engine.** Rejected: the brief is
  explicit that this is one progressively-built application; separate
  repos would fight the "extend, don't rebuild" requirement across
  12 sections and complicate atomic cross-cutting changes (e.g. adding a
  field to `IntelligenceResult`).

## Consequences
- Adding a fifth agent (Tennis, MMA, esports, ...) means adding a new
  provider interface + mock adapter in `packages/sports` and a new agent
  class in `packages/intelligence` — `packages/decision-engine`,
  `packages/picks`, and `apps/miniapp` need no changes.
- Every package must declare its real dependencies; nothing can be reached
  via a transitive `node_modules` accident under pnpm's strict
  node_modules layout.
