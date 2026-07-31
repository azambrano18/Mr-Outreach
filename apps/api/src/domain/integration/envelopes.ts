/**
 * The command/event contracts every layer of the simulated-engine
 * integration shares — the Outbox, the Inbox, `MailEnginePort`, both
 * adapters, and (eventually) the real remote engine all speak these same
 * shapes. Nothing here is simulation-only; this is what production will
 * use too (see §3 of the simulation-mode spec — "el simulador debe
 * reutilizar los mismos contratos JSON").
 */

export const COMMAND_SCHEMA_VERSION = '1.0';

export type CommandType =
  | 'MAILBOX_PROVISION_REQUESTED'
  | 'SEQUENCE_PUBLISH_REQUESTED'
  | 'SEQUENCE_IMPORT_REQUESTED'
  | 'SEQUENCE_CONTACT_REMOVE_REQUESTED'
  | 'SEQUENCE_COMPANY_REMOVE_REQUESTED'
  | 'PROSPECT_SEQUENCE_ACTION'
  /**
   * Fase 2.1 — durable idempotency/audit record for the token-based
   * linking flow. Deliberately distinct from MAILBOX_PROVISION_REQUESTED
   * (that one represents local IMAP/SMTP credential provisioning; this one
   * never carries any credential). Never dispatched through
   * MailEnginePort/IntegrationService.advance() — the "engine" here is
   * MailboxMotorPort, called directly, not through the Outbox/Inbox.
   */
  | 'MAILBOX_LINK_REQUESTED'
  | 'MAILBOX_UNLINK_REQUESTED'
  /** Fase 2.1 — purely local idempotency/audit record; never talks to the motor (no token, no client/domain/email change). */
  | 'MAILBOX_REASSIGN_PRIMARY_REQUESTED'
  /**
   * Fase "Comandos y eventos del flujo activo" — Alternativa A: durable
   * traceability for the active Plantillas/Gestiones flow, layered on top
   * of (never replacing) the existing SequenceTemplateVersion.status /
   * SequenceExecution.status state machines, which remain the actual
   * concurrency-control mechanism (conditionalUpdateStatus). These rows
   * are never dispatched through IntegrationService/MailEnginePort — the
   * motor is called directly via SequenceTemplateMotorPort/
   * SequenceExecutionMotorPort, strictly outside any open transaction.
   */
  | 'TEMPLATE_PUBLISH_REQUESTED'
  | 'SEQUENCE_EXECUTION_START_REQUESTED';

export type EventType =
  | 'MAILBOX_PROVISION_ACCEPTED'
  | 'MAILBOX_PROVISION_STARTED'
  | 'MAILBOX_IMAP_VALIDATED'
  | 'MAILBOX_SMTP_VALIDATED'
  | 'MAILBOX_PROVISION_COMPLETED'
  | 'MAILBOX_PROVISION_FAILED'
  | 'SEQUENCE_PUBLISH_ACCEPTED'
  | 'SEQUENCE_PUBLISH_COMPLETED'
  | 'SEQUENCE_PUBLISH_FAILED'
  | 'SEQUENCE_IMPORT_ACCEPTED'
  | 'SEQUENCE_IMPORT_PROCESSING'
  | 'SEQUENCE_IMPORT_BATCH_COMPLETED'
  | 'SEQUENCE_IMPORT_COMPLETED'
  | 'SEQUENCE_IMPORT_PARTIALLY_COMPLETED'
  | 'SEQUENCE_IMPORT_FAILED'
  | 'CONTACT_SCHEDULED'
  | 'EMAIL_QUEUED'
  | 'EMAIL_SENT'
  | 'EMAIL_FAILED'
  | 'EMAIL_RETRY_SCHEDULED'
  | 'EMAIL_CANCELLED'
  | 'SEQUENCE_CONTACT_REMOVED'
  | 'SEQUENCE_COMPANY_REMOVED'
  | 'INBOUND_REPLY_MATCHED'
  | 'INBOUND_REPLY_UNMATCHED'
  | 'PROSPECT_SEQUENCE_ACTION_APPLIED'
  /**
   * Fase "Recepción de eventos del motor" — the active Plantillas/Gestiones
   * flow's own event vocabulary. Unlike everything above (produced
   * internally by SimulatedMailEngineAdapter, origin always SIMULATED),
   * these are the types a real external motor (origin REMOTE) or the
   * dev-only synthetic emitter (origin SIMULATED) POSTs to
   * `/integration/events`. aggregateType is always EXECUTION for these.
   */
  | 'EXECUTION_ACCEPTED'
  | 'EXECUTION_PROCESSING'
  | 'OUTBOUND_MESSAGE_CREATED'
  | 'OUTBOUND_MESSAGE_SENT'
  | 'INBOUND_MESSAGE_RECEIVED'
  | 'EXECUTION_COMPLETED'
  | 'EXECUTION_FAILED'
  | 'FUTURE_JOBS_CANCELLED';

/** The envelope every command carries, regardless of `commandType` — §9. */
export interface CommandEnvelope<TPayload = Record<string, unknown>> {
  schemaVersion: string;
  commandId: string;
  commandType: CommandType;
  idempotencyKey: string;
  organizationId: string;
  correlationId: string;
  requestedBy: string;
  requestedAt: string;
  payload: TPayload;
}

/** The envelope every event carries — §11 and throughout. */
export interface EventEnvelope<TPayload = Record<string, unknown>> {
  schemaVersion: string;
  eventId: string;
  eventType: EventType;
  commandId: string | null;
  correlationId: string;
  organizationId: string;
  occurredAt: string;
  /**
   * Fase "Recepción de eventos del motor" — optional: the legacy
   * SimulatedMailEngineAdapter events above don't set these (they're
   * resolved from `commandId` instead, see IntegrationCommand.aggregateType/
   * aggregateId). The new active-flow event types always set both.
   */
  aggregateType?: 'TEMPLATE' | 'EXECUTION';
  aggregateId?: string;
  payload: TPayload;
}
