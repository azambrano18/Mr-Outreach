import { IsIn, IsISO8601, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { EventType } from '../../../domain/integration/envelopes';

/** Fase "Recepción de eventos del motor" — active-flow event types accepted by POST /integration/events. Legacy EventType values (MAILBOX_PROVISION_*, SEQUENCE_PUBLISH_*, etc.) are never sent here — those remain internal to SimulatedMailEngineAdapter. */
export const MOTOR_EVENT_TYPES = [
  'EXECUTION_ACCEPTED',
  'EXECUTION_PROCESSING',
  'OUTBOUND_MESSAGE_CREATED',
  'OUTBOUND_MESSAGE_SENT',
  'INBOUND_MESSAGE_RECEIVED',
  'EXECUTION_COMPLETED',
  'EXECUTION_FAILED',
  'FUTURE_JOBS_CANCELLED',
  'EXECUTION_PAUSE_ACCEPTED',
  'EXECUTION_PAUSED',
  'EXECUTION_RESUME_ACCEPTED',
  'EXECUTION_RESUMED',
  'EXECUTION_STOP_ACCEPTED',
  'EXECUTION_STOPPED',
] as const satisfies readonly EventType[];

export type MotorEventType = (typeof MOTOR_EVENT_TYPES)[number];

export const MOTOR_EVENT_SCHEMA_VERSION = '1.0';

export class MotorEventEnvelopeDto {
  @IsString()
  @IsIn([MOTOR_EVENT_SCHEMA_VERSION])
  schemaVersion!: string;

  @IsString()
  @IsNotEmpty()
  eventId!: string;

  @IsString()
  @IsIn(MOTOR_EVENT_TYPES)
  eventType!: MotorEventType;

  @IsISO8601()
  occurredAt!: string;

  @IsString()
  @IsNotEmpty()
  organizationId!: string;

  @IsOptional()
  @IsString()
  commandId?: string | null;

  @IsString()
  @IsNotEmpty()
  correlationId!: string;

  @IsOptional()
  @IsString()
  @IsIn(['TEMPLATE', 'EXECUTION'])
  aggregateType?: 'TEMPLATE' | 'EXECUTION';

  @IsOptional()
  @IsString()
  aggregateId?: string;

  @IsObject()
  payload!: Record<string, unknown>;
}
