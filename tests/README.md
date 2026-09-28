# Cross-Package Integration Tests

Package-level unit tests live colocated inside each package
(`packages/*/src/**/*.test.ts`) — that's where most coverage belongs.
This top-level `tests/` directory is reserved for tests that exercise
more than one package together, mirroring the product's high-level
architecture (Identity → License → Global Control → ... → Audit).

`tests/agents/execution-pipeline.test.ts` is the first one: it wires
`@sport-os/agent-core`, `@sport-os/platform`'s `GlobalExecutionGate`, and
`InMemoryAuditService` together end-to-end, using simple test-double gate
checks (no real identity/license/risk logic exists yet — see Section 01
scope).
