import { ConflictException, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { IntegrationEvent } from '../../domain/integration/integration-event.entity';
import { IntegrationEventRepository } from '../../domain/integration/integration-event.repository';
import { ProcessMotorEventUseCase } from './process-motor-event.use-case';
import { RetryMotorEventUseCase } from './retry-motor-event.use-case';

describe('RetryMotorEventUseCase', () => {
  let events: jest.Mocked<IntegrationEventRepository>;
  let auditLogs: jest.Mocked<AuditLogRepository>;
  let processEvent: jest.Mocked<Pick<ProcessMotorEventUseCase, 'attemptProjection'>>;
  let useCase: RetryMotorEventUseCase;

  const orgId = 'org_1';

  function buildEvent(overrides: Partial<IntegrationEvent> = {}): IntegrationEvent {
    return {
      id: 'row_1',
      organizationId: orgId,
      eventId: 'evt_1',
      eventType: 'OUTBOUND_MESSAGE_SENT',
      commandId: null,
      correlationId: 'corr_1',
      schemaVersion: '1.0',
      aggregateType: 'EXECUTION',
      aggregateId: 'exec_1',
      payload: {},
      status: 'FAILED_RETRYABLE',
      origin: 'REMOTE',
      occurredAt: new Date(),
      receivedAt: new Date(),
      processedAt: null,
      processingError: 'boom',
      errorCode: 'OUTBOUND_MESSAGE_NOT_FOUND',
      failedAt: new Date(),
      attempts: 1,
      ...overrides,
    };
  }

  beforeEach(() => {
    events = {
      findById: jest.fn(),
      findByEventId: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      conditionalClaimForProcessing: jest.fn(),
    };
    auditLogs = { record: jest.fn(), findAll: jest.fn() };
    processEvent = { attemptProjection: jest.fn().mockResolvedValue({ outcome: 'PROCESSED', eventId: 'evt_1' }) };

    useCase = new RetryMotorEventUseCase(events, auditLogs, processEvent as unknown as ProcessMotorEventUseCase);
  });

  it('re-projects a FAILED_RETRYABLE event and records an audit entry for the manual retry', async () => {
    const event = buildEvent();
    events.findById.mockResolvedValue(event);

    const result = await useCase.execute(orgId, 'row_1', 'admin_1');

    expect(auditLogs.record).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: orgId, actorId: 'admin_1', action: 'integration_event.manual_retry_requested' }),
    );
    expect(processEvent.attemptProjection).toHaveBeenCalledWith(event);
    expect(result.outcome).toBe('PROCESSED');
  });

  it('rejects with 404 when the event row does not exist', async () => {
    events.findById.mockResolvedValue(null);
    await expect(useCase.execute(orgId, 'missing', 'admin_1')).rejects.toBeInstanceOf(NotFoundException);
    expect(processEvent.attemptProjection).not.toHaveBeenCalled();
  });

  it('rejects with 404 when the event belongs to another organization', async () => {
    events.findById.mockResolvedValue(buildEvent({ organizationId: 'org_other' }));
    await expect(useCase.execute(orgId, 'row_1', 'admin_1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects with 409 when the event is not FAILED_RETRYABLE (e.g. already PROCESSED)', async () => {
    events.findById.mockResolvedValue(buildEvent({ status: 'PROCESSED' }));
    await expect(useCase.execute(orgId, 'row_1', 'admin_1')).rejects.toBeInstanceOf(ConflictException);
    expect(processEvent.attemptProjection).not.toHaveBeenCalled();
  });

  it('rejects with 409 for a FAILED_TERMINAL event — a terminal failure is never auto- or admin-retried', async () => {
    events.findById.mockResolvedValue(buildEvent({ status: 'FAILED_TERMINAL' }));
    await expect(useCase.execute(orgId, 'row_1', 'admin_1')).rejects.toBeInstanceOf(ConflictException);
    expect(processEvent.attemptProjection).not.toHaveBeenCalled();
  });
});
