import { BaseAgent, SideEffectLevel, type AgentDeclaration, type AgentRequest, type AgentResponse } from "@sport-os/agent-core";
import { Entitlement } from "@sport-os/platform";
import { err, ok, type ISODateString, type Result, type UUID } from "@sport-os/shared";
import {
  evaluatePublicationPolicy,
  evaluatePublishingPolicy,
  PublicationSourceType,
  PublishableContentType,
  TelegramPublicationStatus,
  type PublicationCandidate,
  type PublicationPolicyConfig,
  type PublishableContentType as PublishableContentTypeT,
  type TelegramDestinationManager,
  type TelegramPublicationsRepository,
  type TelegramService,
} from "@sport-os/telegram";

/**
 * Telegram Channel Management Agent (Section 06 §11; extended Section
 * 10). Publishes ALREADY-FINALIZED content — it never decides what the
 * content says. "Must NOT change: probabilities, selections, odds,
 * ticket legs, stake, execution result." Enforced structurally:
 * `finalizedText` on the input is the exact, complete message body;
 * this agent never templates, reformats, or recomputes any part of it
 * — it is passed to `TelegramService.sendMessage()`/`replyToMessage()`
 * byte-for-byte.
 *
 * "Do not create a second publication policy engine" — every publish
 * decision is `evaluatePublishingPolicy()` (always) and, when a richer
 * `policy`/`candidate` pair is supplied, also `evaluatePublicationPolicy()`
 * — both from `@sport-os/telegram`'s own Publishing Policy Engine, never
 * reimplemented here.
 *
 * `deps.publications` is OPTIONAL so every Section 06 caller/test that
 * constructs this agent with only `{ destinations, telegram }` keeps
 * compiling and behaving exactly as before (no persistence, no
 * idempotency beyond `AgentOrchestrator`'s own idempotency store).
 * Real production wiring always supplies it — only with a real
 * `TelegramPublicationsRepository` does a retry become durably
 * idempotent at the per-destination level (§49) and does a RESULTS
 * publication reply to its original ticket/pick message (§22).
 */

export interface PublicationTarget {
  readonly destinationId: UUID;
  readonly telegramMessageId: number;
}

export interface TelegramPublicationResult {
  readonly contentReferenceId: string;
  readonly contentType: PublishableContentTypeT;
  readonly published: readonly PublicationTarget[];
  /** Destinations that were considered but not published to, with the Publishing Policy Engine's own reason — never silently dropped. */
  readonly skipped: readonly { readonly destinationId: UUID; readonly reason: string }[];
  readonly completedAt: ISODateString;
}

export interface TelegramChannelAgentInput {
  readonly contentReferenceId: string;
  readonly contentType: PublishableContentTypeT;
  /** The complete, final message text — this agent treats it as opaque and never alters a single character of it. */
  readonly finalizedText: string;
  /** Section 10 additions — all optional, additive. Supplying them enables durable per-destination idempotency, reply-to-original for RESULTS, and the richer Publishing Policy Engine; omitting them preserves exact Section 06 behavior. */
  readonly sourceType?: PublicationSourceType;
  readonly sourceVersion?: number;
  readonly requestedBy?: string;
  readonly templateVersion?: string;
  /** Supplying BOTH `policy` and `candidate` opts into `evaluatePublicationPolicy()`'s richer market/league/data-quality/daily-limit checks, in addition to the always-run destination-flag check. Omitting either keeps the Section 06 "destination flag only" behavior. */
  readonly policy?: PublicationPolicyConfig;
  readonly candidate?: PublicationCandidate;
}

export interface TelegramChannelAgentDependencies {
  readonly destinations: TelegramDestinationManager;
  readonly telegram: TelegramService;
  readonly publications?: TelegramPublicationsRepository;
}

export const TELEGRAM_CHANNEL_AGENT_DECLARATION: AgentDeclaration = {
  agentId: "telegram-channel-management-agent",
  agentType: "telegram_channel_management",
  version: "0.2.0",
  capabilities: ["determine_eligible_destinations", "request_publication", "track_message_ids", "associate_ticket_destination_message"],
  requiredEntitlements: [Entitlement.TELEGRAM_AUTO_PUBLISH],
  allowedInputs: ["REQUEST_PUBLICATION"],
  allowedOutputs: ["PUBLICATION_COMPLETED"],
  dependencies: [],
  // Publication is a REQUESTED_ACTION at minimum — it causes a real external side effect via TelegramService, gated the same way any other requested action is.
  sideEffectLevel: SideEffectLevel.REQUESTED_ACTION,
};

function startOfUtcDay(now: Date): ISODateString {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export class TelegramChannelManagementAgent extends BaseAgent<TelegramChannelAgentInput, TelegramPublicationResult> {
  constructor(
    private readonly deps: TelegramChannelAgentDependencies,
    agentId: string = TELEGRAM_CHANNEL_AGENT_DECLARATION.agentId,
  ) {
    super({ agentId, agentType: TELEGRAM_CHANNEL_AGENT_DECLARATION.agentType, name: "Telegram Channel Management Agent", version: TELEGRAM_CHANNEL_AGENT_DECLARATION.version, capabilities: TELEGRAM_CHANNEL_AGENT_DECLARATION.capabilities });
  }

  async execute(request: AgentRequest<TelegramChannelAgentInput>): Promise<AgentResponse<TelegramPublicationResult>> {
    const { input } = request;
    const destinations = await this.deps.destinations.list();

    const published: PublicationTarget[] = [];
    const skipped: { destinationId: UUID; reason: string }[] = [];

    const sourceType = input.sourceType ?? PublicationSourceType.TICKET;
    const sourceVersion = input.sourceVersion ?? 1;
    const requestedBy = input.requestedBy ?? request.audit.actor;
    const policyVersion = input.policy?.policyVersion ?? "none";
    const templateVersion = input.templateVersion ?? "legacy_v1";
    const correlationId = (request.audit.correlationId ?? request.requestId) as UUID;

    for (const destination of destinations) {
      // Always-run, narrow check (§8's own publish_* flags) — never
      // skipped even when the richer engine is also used, mirroring
      // evaluatePublicationPolicy()'s own internal call to it.
      const basicDecision = evaluatePublishingPolicy(destination, input.contentType);
      if (!basicDecision.allowed) {
        skipped.push({ destinationId: destination.destinationId, reason: basicDecision.reason });
        continue;
      }

      if (input.policy && input.candidate) {
        const publicationsToday = this.deps.publications ? await this.deps.publications.countPublishedSince(destination.destinationId, input.contentType, startOfUtcDay(new Date())) : 0;
        const richDecision = evaluatePublicationPolicy({
          contentType: input.contentType,
          destination,
          policy: input.policy,
          candidate: input.candidate,
          // Entitlement/identity/license were already verified one layer
          // up, before this agent was ever dispatched (AgentOrchestrator's
          // ExecutionAuthorizer — see PublishingAuthorizer) — never
          // re-checked here with a different data path.
          hasEntitlement: true,
          publicationsToday,
          integrationAvailable: true,
          now: new Date(),
        });
        if (richDecision.decision === "REJECT") {
          skipped.push({ destinationId: destination.destinationId, reason: richDecision.reason });
          continue;
        }
      }

      const sendOutcome = await this.publishToDestination({
        destinationId: destination.destinationId,
        telegramChatId: destination.telegramChatId,
        input,
        sourceType,
        sourceVersion,
        requestedBy,
        policyVersion,
        templateVersion,
        correlationId,
      });
      if (sendOutcome.ok) {
        published.push({ destinationId: destination.destinationId, telegramMessageId: sendOutcome.value });
      } else {
        skipped.push({ destinationId: destination.destinationId, reason: sendOutcome.error });
      }
    }

    const result: TelegramPublicationResult = { contentReferenceId: input.contentReferenceId, contentType: input.contentType, published, skipped, completedAt: new Date().toISOString() };
    return { requestId: request.requestId, output: result, completedAt: new Date().toISOString() };
  }

  /**
   * One destination's own publish attempt, fully isolated from every
   * other destination (§50 — "one destination's failure must not
   * falsely mark another as failed"), already guaranteed structurally
   * by `execute()`'s per-destination loop above.
   */
  private async publishToDestination(params: {
    readonly destinationId: UUID;
    readonly telegramChatId: string;
    readonly input: TelegramChannelAgentInput;
    readonly sourceType: PublicationSourceType;
    readonly sourceVersion: number;
    readonly requestedBy: string;
    readonly policyVersion: string;
    readonly templateVersion: string;
    readonly correlationId: UUID;
  }): Promise<Result<number, string>> {
    const { input, destinationId, telegramChatId } = params;

    if (!this.deps.publications) {
      // No durable persistence configured — legacy Section 06 behavior:
      // send once, no idempotency beyond AgentOrchestrator's own.
      const result = await this.deps.telegram.sendMessage(telegramChatId, input.finalizedText);
      return result.ok ? ok(result.value.messageId) : err(result.error.message);
    }

    const row = await this.deps.publications.findOrCreate({
      sourceType: params.sourceType,
      sourceId: input.contentReferenceId,
      sourceVersion: params.sourceVersion,
      publicationType: input.contentType,
      destinationId,
      templateVersion: params.templateVersion,
      policyVersion: params.policyVersion,
      requestedBy: params.requestedBy,
      // Deterministic, not random — a genuine retry for the same tuple
      // must compute the SAME key (it is recorded for traceability only;
      // the real enforcement is the natural-key unique index `findOrCreate()`
      // upserts against, see TelegramPublicationsRepository's own doc comment).
      idempotencyKey: `${params.sourceType}:${input.contentReferenceId}:${params.sourceVersion}:${input.contentType}:${destinationId}`,
      correlationId: params.correlationId,
    });

    // The idempotency boundary (§49): a prior PUBLISHED row for this
    // exact tuple means a real Telegram message already exists — never
    // call sendMessage()/replyToMessage() a second time for it.
    if (row.status === TelegramPublicationStatus.PUBLISHED && row.telegramMessageId !== undefined) {
      return ok(row.telegramMessageId);
    }

    const sendResult =
      input.contentType === PublishableContentType.RESULTS
        ? await this.sendResultsReply(telegramChatId, input.finalizedText, params.sourceType, input.contentReferenceId, destinationId)
        : await this.deps.telegram.sendMessage(telegramChatId, input.finalizedText);

    if (sendResult.ok) {
      await this.deps.publications.transitionTo(row.id, { status: TelegramPublicationStatus.PUBLISHED, telegramMessageId: sendResult.value.messageId });
      return ok(sendResult.value.messageId);
    }
    await this.deps.publications.transitionTo(row.id, { status: TelegramPublicationStatus.FAILED, lastError: sendResult.error.message });
    return err(sendResult.error.message);
  }

  /** §22 — a RESULTS publication replies to the original ticket/pick message at this destination when one is on record; falls back to a plain send (never fabricated) when none is. */
  private async sendResultsReply(telegramChatId: string, text: string, sourceType: PublicationSourceType, sourceId: string, destinationId: UUID) {
    const original = await this.deps.publications!.findOriginalMessageForReply({ sourceType, sourceId, destinationId });
    if (original?.telegramMessageId !== undefined) {
      return this.deps.telegram.replyToMessage(telegramChatId, original.telegramMessageId, text);
    }
    return this.deps.telegram.sendMessage(telegramChatId, text);
  }
}
