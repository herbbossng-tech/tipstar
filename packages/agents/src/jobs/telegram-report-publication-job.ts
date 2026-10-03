import { AgentFailureCode, CommandType, CURRENT_AGENT_MESSAGE_SCHEMA_VERSION, MessageKind, SideEffectLevel, buildAgentExecutionContext, type AgentMessage, type AgentOrchestrator } from "@sport-os/agent-core";
import { JobFailureCategory, OperationalJobType, type OperationalJobRecord } from "@sport-os/platform";
import { generateId, type UUID } from "@sport-os/shared";
import { renderPerformanceMessage } from "@sport-os/telegram";
import { PublicationSourceType, PublishableContentType } from "@sport-os/telegram";
import type { SupabaseWeeklyReportsRepository } from "../db/repositories.js";
import { TELEGRAM_CHANNEL_AGENT_DECLARATION, type TelegramChannelAgentInput, type TelegramChannelManagementAgent, type TelegramPublicationResult } from "../telegram-channel-agent.js";
import type { WeeklyReport } from "../weekly-report-service.js";
import type { JobHandler, JobHandlerResult } from "./worker.js";

/**
 * TELEGRAM_REPORT_PUBLICATION (Section 11 Part N). "Use the Section 10
 * Telegram publishing system. Do NOT directly call Telegram APIs from
 * the reporting engine." This handler never touches `TelegramService`
 * or any Bot API call itself — it builds a `REQUEST_PUBLICATION`
 * `AgentMessage` and dispatches it through the SAME
 * `AgentOrchestrator.dispatch()` -> `TelegramChannelManagementAgent`
 * path every other publication in this codebase goes through,
 * preserving the real Publishing Policy Engine check, the real
 * `PublishingAuthorizer` identity/license/entitlement check, and the
 * real per-destination idempotency — nothing here is a shortcut around
 * any of it.
 *
 * "If publication fails: report generation remains successful;
 * publication job can fail independently; publication failure must not
 * alter report contents." This handler only ever READS the already-
 * FINALIZED `weekly_reports` row — it never writes to it.
 */

export interface TelegramReportPublicationJobDependencies {
  readonly orchestrator: AgentOrchestrator;
  readonly channelAgent: TelegramChannelManagementAgent;
  readonly reports: SupabaseWeeklyReportsRepository;
}

function toPerformanceMessageInput(report: WeeklyReport) {
  return {
    ledgerMode: report.ledgerMode,
    periodLabel: `${report.periodStart.slice(0, 10)} to ${report.periodEnd.slice(0, 10)}`,
    netPnl: report.financialTotals?.actualPnl ?? null,
    roi: report.financialTotals?.roi ?? null,
    sampleSize: report.ticketCounts.total,
    wins: report.ticketCounts.won,
    losses: report.ticketCounts.lost,
  };
}

function classifyDispatchFailure(code: string): JobFailureCategory {
  switch (code) {
    case AgentFailureCode.AUTHORIZATION_ERROR:
      return JobFailureCategory.AUTHORIZATION_DENIED;
    case AgentFailureCode.ENTITLEMENT_ERROR:
      return JobFailureCategory.LICENSE_DENIED;
    case AgentFailureCode.POLICY_REJECTED:
      return JobFailureCategory.POLICY_REJECTED;
    case AgentFailureCode.INTEGRATION_UNAVAILABLE:
      return JobFailureCategory.INTEGRATION_UNAVAILABLE;
    case AgentFailureCode.TIMEOUT:
      return JobFailureCategory.TIMEOUT;
    case AgentFailureCode.VALIDATION_ERROR:
      return JobFailureCategory.INVALID_PAYLOAD;
    default:
      return JobFailureCategory.UNKNOWN;
  }
}

export class TelegramReportPublicationJobHandler implements JobHandler {
  readonly jobType: OperationalJobType = OperationalJobType.TELEGRAM_REPORT_PUBLICATION;

  constructor(private readonly deps: TelegramReportPublicationJobDependencies) {}

  async handle(job: OperationalJobRecord): Promise<JobHandlerResult> {
    const reportId = job.payloadReference.reportId as string | undefined;
    if (!reportId) {
      return { ok: false, category: JobFailureCategory.INVALID_PAYLOAD, message: "payloadReference.reportId is required." };
    }

    const reportRecord = await this.deps.reports.findById(reportId as UUID);
    if (!reportRecord) {
      return { ok: false, category: JobFailureCategory.DATA_UNAVAILABLE, message: `No weekly report found with id "${reportId}".` };
    }
    const report = reportRecord.reportPayload as unknown as WeeklyReport;

    const rendered = renderPerformanceMessage(toPerformanceMessageInput(report));
    const input: TelegramChannelAgentInput = {
      contentReferenceId: reportRecord.reportId,
      contentType: PublishableContentType.WEEKLY_REPORT,
      finalizedText: rendered.text,
      sourceType: PublicationSourceType.PERFORMANCE,
      requestedBy: job.createdBy,
    };

    const message: AgentMessage<TelegramChannelAgentInput> = {
      messageId: generateId(),
      correlationId: generateId(),
      kind: MessageKind.COMMAND,
      messageType: CommandType.REQUEST_PUBLICATION,
      schemaVersion: CURRENT_AGENT_MESSAGE_SCHEMA_VERSION,
      sourceAgent: "system",
      targetAgent: TELEGRAM_CHANNEL_AGENT_DECLARATION.agentType as never,
      payload: input,
      idempotencyKey: `telegram-report-publication:${reportRecord.reportId}`,
      createdAt: new Date().toISOString(),
    };

    const context = buildAgentExecutionContext({
      invocationId: generateId(),
      correlationId: message.correlationId,
      actorUserId: job.createdBy,
      actorRole: "system",
      environment: "production",
      requestedOperation: "publish_weekly_report",
    });

    const result = await this.deps.orchestrator.dispatch<TelegramChannelAgentInput, TelegramPublicationResult>({
      message,
      agent: this.deps.channelAgent,
      declaration: TELEGRAM_CHANNEL_AGENT_DECLARATION,
      context,
      sideEffectLevel: SideEffectLevel.REQUESTED_ACTION,
    });

    if (!result.ok) {
      return { ok: false, category: classifyDispatchFailure(result.error.failure.code), message: result.error.failure.message };
    }
    return { ok: true };
  }
}
