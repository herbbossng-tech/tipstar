/** Row shapes for the Section 06 agent-operational tables — see supabase/migrations/*agent_invocations.sql / *agent_messages.sql. */

export interface AgentInvocationRow {
  readonly id: string;
  readonly agent_id: string;
  readonly agent_type: string;
  readonly agent_version: string;
  readonly correlation_id: string;
  readonly requested_by: string;
  readonly side_effect_level: string;
  readonly status: string;
  readonly failure_disposition: string | null;
  readonly failure_code: string | null;
  readonly failure_message: string | null;
  readonly failure_context: Record<string, unknown> | null;
  readonly input_reference: string;
  readonly output_reference: string | null;
  readonly idempotency_key: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly completed_at: string | null;
}

export interface AgentMessageRow {
  readonly id: string;
  readonly correlation_id: string;
  readonly kind: string;
  readonly message_type: string;
  readonly schema_version: number;
  readonly source_agent: string;
  readonly target_agent: string;
  readonly payload: Record<string, unknown>;
  readonly idempotency_key: string | null;
  readonly created_at: string;
}

/** Row shapes for the Section 10 Telegram publishing tables — see supabase/migrations/*telegram_destinations.sql / *telegram_publications.sql. */

export interface TelegramDestinationRow {
  readonly destination_id: string;
  readonly telegram_chat_id: string;
  readonly name: string;
  readonly type: string;
  readonly enabled: boolean;
  readonly auto_publish: boolean;
  readonly publish_booking_code: boolean;
  readonly publish_ticket: boolean;
  readonly publish_results: boolean;
  readonly publish_weekly_report: boolean;
  readonly verification_status: string;
  readonly verified_at: string | null;
  readonly created_by: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface TelegramPublicationRow {
  readonly id: string;
  readonly source_type: string;
  readonly source_id: string;
  readonly source_version: number;
  readonly publication_type: string;
  readonly destination_id: string;
  readonly status: string;
  readonly telegram_message_id: number | null;
  readonly reply_to_telegram_message_id: number | null;
  readonly template_version: string;
  readonly policy_version: string;
  readonly requested_by: string;
  readonly idempotency_key: string;
  readonly correlation_id: string;
  readonly attempt_count: number;
  readonly last_error: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}
