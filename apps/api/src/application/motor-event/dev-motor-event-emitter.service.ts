import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { IntegrationCommandRepository } from '../../domain/integration/integration-command.repository';
import { SequenceExecutionRepository } from '../../domain/sequence-execution/sequence-execution.repository';
import { INTEGRATION_COMMAND_REPOSITORY, SEQUENCE_EXECUTION_REPOSITORY } from '../../infrastructure/persistence/tokens';
import { MotorEventEnvelopeDto, MOTOR_EVENT_SCHEMA_VERSION, MotorEventType } from '../../modules/integration/dto/motor-event-envelope.dto';
import { ProcessMotorEventResult, ProcessMotorEventUseCase } from './process-motor-event.use-case';

/**
 * Fase 12 — "el simulador debe usar el mismo DTO; usar el mismo caso de
 * uso; usar la misma persistencia". This service builds a real, fully-
 * formed MotorEventEnvelopeDto (generating eventId, reusing the
 * execution's own IntegrationCommand commandId/correlationId when one
 * exists) and calls ProcessMotorEventUseCase directly — never the HTTP
 * endpoint, so HMAC authentication is never in scope here (this is the
 * explicit development/test adapter Fase 4 allows for). Only reachable
 * through DevMotorEventsController, itself gated by
 * SEQUENCE_MOTOR_MODE=simulated + NODE_ENV!=production, exactly like
 * DevSimulatedExecutionsController.
 */
@Injectable()
export class DevMotorEventEmitterService {
  constructor(
    @Inject(SEQUENCE_EXECUTION_REPOSITORY) private readonly executions: SequenceExecutionRepository,
    @Inject(INTEGRATION_COMMAND_REPOSITORY) private readonly commands: IntegrationCommandRepository,
    private readonly processEvent: ProcessMotorEventUseCase,
  ) {}

  async emit(
    organizationId: string,
    executionId: string,
    eventType: MotorEventType,
    payload: Record<string, unknown>,
  ): Promise<{ envelope: MotorEventEnvelopeDto; result: ProcessMotorEventResult }> {
    const execution = await this.executions.findById(executionId);
    if (!execution || execution.organizationId !== organizationId) {
      throw new NotFoundException('Gestión no encontrada.');
    }

    const relatedCommands = await this.commands.findAll(organizationId, {
      aggregateType: 'EXECUTION',
      aggregateId: executionId,
    });
    const latestCommand = relatedCommands[0] ?? null;

    const envelope: MotorEventEnvelopeDto = Object.assign(new MotorEventEnvelopeDto(), {
      schemaVersion: MOTOR_EVENT_SCHEMA_VERSION,
      eventId: `evt_${randomUUID()}`,
      eventType,
      occurredAt: new Date().toISOString(),
      organizationId,
      commandId: latestCommand?.commandId ?? null,
      correlationId: latestCommand?.correlationId ?? `corr_${randomUUID()}`,
      aggregateType: 'EXECUTION' as const,
      aggregateId: executionId,
      payload,
    });

    const result = await this.processEvent.execute({ envelope, origin: 'SIMULATED' });
    return { envelope, result };
  }
}
