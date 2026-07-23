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
  | 'PROSPECT_SEQUENCE_ACTION';

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
  | 'PROSPECT_SEQUENCE_ACTION_APPLIED';

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
  payload: TPayload;
}
