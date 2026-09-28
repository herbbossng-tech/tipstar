# Agent Core

`@sport-os/agent-core` is the reusable contract every agent named in the
product definition eventually implements.

## Every named agent

| Agent | `AgentType` |
|---|---|
| Football Intelligence Agent | `football_intelligence` |
| Football Decision/Ticket Agent | `football_decision` |
| Football Automation Agent | `football_automation` |
| Telegram Channel Management Agent | `telegram_channel_management` |
| Settlement Agent | `settlement` |
| Weekly Report Agent | `weekly_report` |
| Aviator Intelligence Agent | `aviator_intelligence` |
| Aviator Risk Agent | `aviator_risk` |
| Aviator Automation Agent | `aviator_automation` |
| Global Daily Risk Controller | `global_daily_risk_controller` |
| Performance Agent | `performance` |

None of these agents are implemented yet — Section 01 only establishes
the contract they'll implement (`Agent<TInput, TOutput>`) and the
lifecycle state machine (`BaseAgent`) they'll extend.

## Lifecycle

```
DISABLED ──────▶ INITIALIZING ──────▶ READY ──────▶ RUNNING
   ▲                  │                 │  ▲            │
   │                  ▼                 │  └────────────┘
   │                ERROR               │   (back to READY)
   │                  │                 ▼
   │                  │              PAUSED
   │                  │                 │
   └──────────────────┴─────────────────┘
```

- `DISABLED → INITIALIZING`
- `INITIALIZING → READY | ERROR`
- `READY → RUNNING | DISABLED`
- `RUNNING → READY | PAUSED | ERROR`
- `PAUSED → RUNNING | DISABLED`
- `ERROR → INITIALIZING | DISABLED`

`BaseAgent.transitionTo()` is the only way a concrete agent changes its
own status, and it throws `ValidationError` (not a silent no-op) on any
transition not in this table — see `base-agent.test.ts` for every
transition exercised, both valid and rejected.

## Where authorization sits

An `Agent.execute()` implementation only knows how to do its own job. It
is never responsible for checking whether it's allowed to run right now
— that's `GlobalExecutionGate`'s job (`@sport-os/platform`), which every
caller must invoke and get `{ authorized: true }` from before calling
`AgentService.execute()`. See `tests/agents/execution-pipeline.test.ts`
for the intended call order.

## Registry

`InMemoryAgentRegistry` (`AgentService`) is a real, tested implementation
— pure bookkeeping (register/get/list/route), not business logic. A
persistent registry is a later-section concern if one is ever needed;
nothing about the interface presumes in-memory storage.
