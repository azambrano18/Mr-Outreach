import { CommandType } from './envelopes';

/**
 * §11's REQUESTED→ACCEPTED→PROCESSING→COMPLETED progression, plus the
 * terminal failure modes the spec explicitly asks to be simulatable.
 */
export type CommandStatus =
  | 'REQUESTED'
  | 'ACCEPTED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'TIMEOUT';

export type AggregateType =
  | 'MAILBOX'
  | 'SEQUENCE'
  | 'SEQUENCE_IMPORT'
  | 'SEQUENCE_CONTACT'
  | 'SEQUENCE_COMPANY'
  /** Fase "Comandos y eventos del flujo activo" — Alternativa A. aggregateId is a SequenceTemplateVersion.id. */
  | 'TEMPLATE'
  /** aggregateId is a SequenceExecution.id. */
  | 'EXECUTION';

/** The persisted Outbox row — §44. */
export interface IntegrationCommand {
  id: string;
  organizationId: string;
  commandId: string;
  commandType: CommandType;
  aggregateType: AggregateType;
  aggregateId: string;
  schemaVersion: string;
  idempotencyKey: string;
  correlationId: string;
  payload: Record<string, unknown>;
  status: CommandStatus;
  attemptCount: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  requestedBy: string;
  createdAt: Date;
  sentAt: Date | null;
  acceptedAt: Date | null;
  completedAt: Date | null;
  /** Fase 2 — SHA-256 of the canonicalized logical payload of the use case that created this command. Null for commands created before Fase 2 or outside the idempotent-use-case path. */
  payloadHash: string | null;
  /** Fase 2 — sanitized use-case result replayed verbatim on an idempotent retry. Never credentials/tokens/connection strings. */
  resultSnapshot: Record<string, unknown> | null;
  /** Fase 2 — the logical HTTP status code the originating use case returned. */
  httpStatusCode: number | null;
}

export interface CreateIntegrationCommandInput {
  organizationId: string;
  commandId: string;
  commandType: CommandType;
  aggregateType: AggregateType;
  aggregateId: string;
  schemaVersion: string;
  idempotencyKey: string;
  correlationId: string;
  payload: Record<string, unknown>;
  requestedBy: string;
  payloadHash?: string | null;
  resultSnapshot?: Record<string, unknown> | null;
  httpStatusCode?: number | null;
}

export interface UpdateIntegrationCommandInput {
  status?: CommandStatus;
  attemptCount?: number;
  nextAttemptAt?: Date | null;
  lastError?: string | null;
  sentAt?: Date | null;
  acceptedAt?: Date | null;
  completedAt?: Date | null;
  payloadHash?: string | null;
  resultSnapshot?: Record<string, unknown> | null;
  httpStatusCode?: number | null;
}
