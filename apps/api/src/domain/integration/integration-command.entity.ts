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

export type AggregateType = 'MAILBOX' | 'SEQUENCE' | 'SEQUENCE_IMPORT' | 'SEQUENCE_CONTACT' | 'SEQUENCE_COMPANY';

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
}

export interface UpdateIntegrationCommandInput {
  status?: CommandStatus;
  attemptCount?: number;
  nextAttemptAt?: Date | null;
  lastError?: string | null;
  sentAt?: Date | null;
  acceptedAt?: Date | null;
  completedAt?: Date | null;
}
