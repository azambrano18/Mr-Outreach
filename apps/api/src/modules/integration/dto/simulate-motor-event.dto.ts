import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsObject } from 'class-validator';
import { MOTOR_EVENT_TYPES, MotorEventType } from './motor-event-envelope.dto';

/**
 * Dev-only simulation surface (Fase 12) — never a real motor contract. The
 * caller supplies only the parts a human would reasonably hand-author
 * (eventType + the event-specific payload); DevMotorEventEmitterService
 * fills in everything that must stay internally consistent
 * (schemaVersion, eventId, organizationId, aggregateType/aggregateId,
 * commandId/correlationId reused from the execution's own
 * IntegrationCommand when one exists) so a hand-typed payload can never
 * corrupt the envelope's identity/linkage fields.
 */
export class SimulateMotorEventDto {
  @ApiProperty({ enum: MOTOR_EVENT_TYPES })
  @IsIn(MOTOR_EVENT_TYPES)
  eventType!: MotorEventType;

  @ApiProperty({ type: Object, description: 'Event-specific payload — see validateMotorEventPayload for the required shape per eventType.' })
  @IsObject()
  payload!: Record<string, unknown>;
}
