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
