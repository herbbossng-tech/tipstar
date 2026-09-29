import { BaseAgent, SideEffectLevel, type AgentDeclaration, type AgentRequest, type AgentResponse } from "@sport-os/agent-core";
import { Entitlement } from "@sport-os/platform";
import type { ISODateString, UUID } from "@sport-os/shared";
import { evaluatePublishingPolicy, type PublishableContentType, type TelegramDestination, type TelegramDestinationManager, type TelegramService } from "@sport-os/telegram";

/**
 * Telegram Channel Management Agent (Section 06 §11). Publishes ALREADY-
 * FINALIZED content — it never decides what the content says.
 * "Must NOT change: probabilities, selections, odds, ticket legs, stake,
 * execution result." Enforced structurally: `finalizedText` on the
 * input is the exact, complete message body; this agent never templates,
 * reformats, or recomputes any part of it — it is passed to
 * `TelegramService.sendMessage()` byte-for-byte.
 *
 * "Do not create a second publication policy engine" — every publish
 * decision is `evaluatePublishingPolicy()`/`selectPublishableDestinations()`
 * from `@sport-os/telegram`'s own Publishing Policy Engine, never
 * reimplemented here.
 */

export interface PublicationTarget {
  readonly destinationId: UUID;
  readonly telegramMessageId: number;
}

export interface TelegramPublicationResult {
  readonly contentReferenceId: string;
  readonly contentType: PublishableContentType;
  readonly published: readonly PublicationTarget[];
  /** Destinations that were considered but not published to, with the Publishing Policy Engine's own reason — never silently dropped. */
  readonly skipped: readonly { readonly destinationId: UUID; readonly reason: string }[];
  readonly completedAt: ISODateString;
}

export interface TelegramChannelAgentInput {
  readonly contentReferenceId: string;
  readonly contentType: PublishableContentType;
  /** The complete, final message text — this agent treats it as opaque and never alters a single character of it. */
  readonly finalizedText: string;
}

export interface TelegramChannelAgentDependencies {
  readonly destinations: TelegramDestinationManager;
  readonly telegram: TelegramService;
}

export const TELEGRAM_CHANNEL_AGENT_DECLARATION: AgentDeclaration = {
  agentId: "telegram-channel-management-agent",
  agentType: "telegram_channel_management",
  version: "0.1.0",
  capabilities: ["determine_eligible_destinations", "request_publication", "track_message_ids", "associate_ticket_destination_message"],
  requiredEntitlements: [Entitlement.TELEGRAM_AUTO_PUBLISH],
  allowedInputs: ["REQUEST_PUBLICATION"],
  allowedOutputs: ["PUBLICATION_COMPLETED"],
  dependencies: [],
  // Publication is a REQUESTED_ACTION at minimum — it causes a real external side effect via TelegramService, gated the same way any other requested action is.
  sideEffectLevel: SideEffectLevel.REQUESTED_ACTION,
};

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

    for (const destination of destinations) {
      const decision = evaluatePublishingPolicy(destination, input.contentType);
      if (!decision.allowed) {
        skipped.push({ destinationId: destination.destinationId, reason: decision.reason });
        continue;
      }
      const sendResult = await this.sendToDestination(destination, input.finalizedText);
      if (sendResult.ok) {
        published.push({ destinationId: destination.destinationId, telegramMessageId: sendResult.value.messageId });
      } else {
        skipped.push({ destinationId: destination.destinationId, reason: sendResult.error.message });
      }
    }

    const result: TelegramPublicationResult = { contentReferenceId: input.contentReferenceId, contentType: input.contentType, published, skipped, completedAt: new Date().toISOString() };
    return { requestId: request.requestId, output: result, completedAt: new Date().toISOString() };
  }

  private sendToDestination(destination: TelegramDestination, text: string) {
    return this.deps.telegram.sendMessage(destination.telegramChatId, text);
  }
}
