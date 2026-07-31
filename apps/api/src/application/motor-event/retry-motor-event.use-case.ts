import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { IntegrationEventRepository } from '../../domain/integration/integration-event.repository';
import { AUDIT_LOG_REPOSITORY, INTEGRATION_EVENT_REPOSITORY } from '../../infrastructure/persistence/tokens';
import { ProcessMotorEventResult, ProcessMotorEventUseCase } from './process-motor-event.use-case';

/**
 * Fase 11 — the only sanctioned way a FAILED_RETRYABLE motor event gets
 * re-projected: an authenticated admin action (never an automatic loop).
 * FAILED_TERMINAL events are refused outright — a terminal failure means
 * the projector itself concluded the event can never succeed as-is (e.g.
 * the referenced SequenceExecution doesn't exist), and retrying it would
 * just fail identically.
 */
@Injectable()
export class RetryMotorEventUseCase {
  constructor(
    @Inject(INTEGRATION_EVENT_REPOSITORY) private readonly events: IntegrationEventRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    private readonly processEvent: ProcessMotorEventUseCase,
  ) {}

  async execute(organizationId: string, eventRowId: string, actorId: string): Promise<ProcessMotorEventResult> {
    const event = await this.events.findById(eventRowId);
    if (!event || event.organizationId !== organizationId) {
      throw new NotFoundException('Evento no encontrado.');
    }
    if (event.status !== 'FAILED_RETRYABLE') {
      throw new ConflictException('Solo un evento en FAILED_RETRYABLE puede reintentarse.');
    }

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'integration_event.manual_retry_requested',
      entityType: 'IntegrationEvent',
      entityId: event.id,
      metadata: { eventType: event.eventType, previousAttempts: event.attempts },
    });

    return this.processEvent.attemptProjection(event);
  }
}
