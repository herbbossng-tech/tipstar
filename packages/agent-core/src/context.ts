import type { ISODateString, UUID } from "@sport-os/shared";

/**
 * The immutable execution context every agent invocation receives
 * (Section 06 §6). Built once, by the orchestrator, before an agent's
 * `execute()` is ever called — an agent implementation reads this, it
 * never constructs or mutates one.
 *
 * "Do not place secrets into agent context. Do not pass raw Telegram
 * initData through the agent framework." — `actor` and `telegramUserId`
 * carry only the already-verified identity (the same shape
 * `AuthorizationContext`/`AppUser` in `@sport-os/platform` expose), never
 * a session token, initData string, or any other credential. This module
 * intentionally does not import `@sport-os/platform` (agent-core has no
 * dependency on it — platform depends on agent-core, not the reverse),
 * so `actor`/`role` are typed generically here; callers in
 * `@sport-os/agents` construct this from a real `AuthorizationContext`.
 */
export interface AgentExecutionContext {
  readonly invocationId: UUID;
  readonly correlationId: UUID;
  /** The authenticated app user id this invocation acts on behalf of — never a raw credential. */
  readonly actorUserId: UUID;
  readonly actorRole: string;
  /** Present only when this invocation originated from a real Telegram-authenticated request — the numeric Telegram user id only, never initData or a session token. */
  readonly telegramUserId: number | undefined;
  readonly environment: "development" | "staging" | "production";
  readonly createdAt: ISODateString;
  /** The fixture/round/ticket this invocation concerns, when applicable — an opaque reference id, not the full domain object (the agent re-fetches it through its own injected repository, honoring point-in-time rules itself). */
  readonly subjectReference: string | undefined;
  /** Required for any football-intelligence-consuming invocation — see Section 04/05's point-in-time contract. Undefined for invocations that are not fixture/snapshot-scoped (e.g. a weekly report). */
  readonly snapshotTime: ISODateString | undefined;
  readonly requestedOperation: string;
  /** Idempotency key for this invocation, when the caller supplied one — see idempotency.ts. */
  readonly idempotencyKey: string | undefined;
  readonly trace: Readonly<Record<string, string>>;
}

export interface BuildAgentExecutionContextInput {
  readonly invocationId: UUID;
  readonly correlationId: UUID;
  readonly actorUserId: UUID;
  readonly actorRole: string;
  readonly telegramUserId?: number;
  readonly environment: "development" | "staging" | "production";
  readonly subjectReference?: string;
  readonly snapshotTime?: ISODateString;
  readonly requestedOperation: string;
  readonly idempotencyKey?: string;
  readonly trace?: Readonly<Record<string, string>>;
  readonly now?: () => ISODateString;
}

/** The one place an AgentExecutionContext is constructed — Object.freeze guarantees "immutable" is not just a doc comment. */
export function buildAgentExecutionContext(input: BuildAgentExecutionContextInput): AgentExecutionContext {
  const now = (input.now ?? (() => new Date().toISOString()))();
  return Object.freeze({
    invocationId: input.invocationId,
    correlationId: input.correlationId,
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    telegramUserId: input.telegramUserId,
    environment: input.environment,
    createdAt: now,
    subjectReference: input.subjectReference,
    snapshotTime: input.snapshotTime,
    requestedOperation: input.requestedOperation,
    idempotencyKey: input.idempotencyKey,
    trace: Object.freeze({ ...(input.trace ?? {}) }),
  });
}
