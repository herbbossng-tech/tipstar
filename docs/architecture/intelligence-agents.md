# Intelligence Agent Architecture

## The contract

Every agent implements `IntelligenceAgent` (`packages/intelligence/src/agent.ts`):

```ts
interface IntelligenceAgent {
  readonly agentType: AgentType;
  readonly sport: Sport;
  getModelVersion(): string;
  evaluate(input: IntelligenceAgentInput): Promise<IntelligenceResult>;
}
```

`BaseIntelligenceAgent` (`packages/intelligence/src/base-agent.ts`) supplies
shared scaffolding: a `mode: "mock" | "production"` switch, and an
`insufficientData()` helper every agent uses to honestly decline to guess.

## The four Section 01 agents

| Agent | File | Provider dependency |
|---|---|---|
| Football | `agents/football-agent.ts` | `FootballProvider` (`packages/sports/src/football.ts`) |
| Basketball | `agents/basketball-agent.ts` | `BasketballProvider` (`packages/sports/src/basketball.ts`) |
| Virtual Football | `agents/virtual-football-agent.ts` | `VirtualFootballProvider` (`packages/sports/src/virtual-football.ts`) |
| Aviator | `agents/aviator-agent.ts` | `AviatorProvider` (`packages/sports/src/aviator.ts`) |

Virtual Football is a **separate provider interface and agent** from
Football — it draws on result-distribution/sequence data, never on
injuries, lineups, or head-to-head history, because a virtual fixture has
none of those. Aviator does not extend `SportsProvider` at all: it has no
teams or fixtures, only round/multiplier history.

## Why production mode returns INSUFFICIENT_DATA

Per the product brief: "Do NOT implement fake prediction logic merely to
make the system appear intelligent." No agent has a real statistical model
in Section 01. `BaseIntelligenceAgent.evaluateProduction()` defaults to
returning `IntelligenceResultStatus.INSUFFICIENT_DATA` with an evidence
item explaining why. A later section overrides `evaluateProduction()` once
a real model exists for that agent — this is the seam where that work
plugs in, not a placeholder that will be thrown away.

## Mock mode

`mode: "mock"` (paired with a mock provider from `packages/sports/src/mock/`)
exercises the full contract end-to-end for development and tests. Every
mock result sets `IntelligenceResult.isMock = true`. Consumers (Decision
Engine, Pick Engine, UI) must never present a mock result as a real
prediction — this flag exists so that check is enforceable, not just
documented. See `packages/intelligence/src/agents/football-agent.test.ts`
for the test asserting production mode never fabricates a probability.

## Aviator: no hard-coded win rate

`AviatorAgent` never encodes a fixed target (e.g. "80%"). Any target rate
is a claim that must be evaluated against real historical/out-of-sample
performance in a later section (backtesting), and even then presented as
an evaluated result, never a guarantee.

## Evidence-first

Every `IntelligenceResult.evidence` item is tagged with a `sourceType`:
`provider_data`, `statistical_model`, or `derived_feature`. There is no
`sourceType` for "LLM claim" — an LLM is never a source of evidence. See
`docs/architecture/overview.md`'s data-flow diagram for where an LLM may
be introduced later (explanation only, after the Decision Engine).
