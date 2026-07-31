import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { IntegrationEvent } from '../../domain/integration/integration-event.entity';
import { IntegrationEventRepository } from '../../domain/integration/integration-event.repository';
import { TransactionContext, TransactionManager } from '../../domain/persistence/transaction';
import { MotorEventEnvelopeDto, MOTOR_EVENT_SCHEMA_VERSION } from '../../modules/integration/dto/motor-event-envelope.dto';
import { MotorEventProjectionError, MotorEventProjector } from './motor-event-projector.service';
import { MAX_PROJECTION_ATTEMPTS, ProcessMotorEventUseCase } from './process-motor-event.use-case';

class FakeTransactionManager implements TransactionManager {
  async run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    return work({ kind: 'fake' });
  }
}

describe('ProcessMotorEventUseCase', () => {
  let events: jest.Mocked<IntegrationEventRepository>;
  let auditLogs: jest.Mocked<AuditLogRepository>;
  let projector: jest.Mocked<Pick<MotorEventProjector, 'project'>>;
  let useCase: ProcessMotorEventUseCase;

  const orgId = 'org_1';

  function buildEnvelope(overrides: Partial<MotorEventEnvelopeDto> = {}): MotorEventEnvelopeDto {
    return {
      schemaVersion: MOTOR_EVENT_SCHEMA_VERSION,
      eventId: 'evt_1',
      eventType: 'EXECUTION_ACCEPTED',
      occurredAt: new Date().toISOString(),
      organizationId: orgId,
      commandId: null,
      correlationId: 'corr_1',
      aggregateType: 'EXECUTION',
      aggregateId: 'exec_1',
      payload: { serverExecutionId: 'srv_1' },
      ...overrides,
    };
  }

  function buildStoredEvent(overrides: Partial<IntegrationEvent> = {}): IntegrationEvent {
    return {
      id: 'row_1',
      organizationId: orgId,
      eventId: 'evt_1',
      eventType: 'EXECUTION_ACCEPTED',
      commandId: null,
      correlationId: 'corr_1',
      schemaVersion: MOTOR_EVENT_SCHEMA_VERSION,
      aggregateType: 'EXECUTION',
      aggregateId: 'exec_1',
      payload: { serverExecutionId: 'srv_1' },
      status: 'RECEIVED',
      origin: 'REMOTE',
      occurredAt: new Date(),
      receivedAt: new Date(),
      processedAt: null,
      processingError: null,
      errorCode: null,
      failedAt: null,
      attempts: 0,
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
      conditionalClaimForProcessing: jest.fn().mockResolvedValue(1),
    };
    auditLogs = { record: jest.fn(), findAll: jest.fn() };
    projector = { project: jest.fn().mockResolvedValue(undefined) };

    useCase = new ProcessMotorEventUseCase(new FakeTransactionManager(), events, auditLogs, projector as unknown as MotorEventProjector);
  });

  it('rejects an unsupported schemaVersion without ever touching the repository', async () => {
    const result = await useCase.execute({ envelope: buildEnvelope({ schemaVersion: '9.9' }), origin: 'REMOTE' });

    expect(result.outcome).toBe('INVALID_PAYLOAD');
    expect(events.findByEventId).not.toHaveBeenCalled();
    expect(events.create).not.toHaveBeenCalled();
  });

  it('rejects a payload missing a required field for its eventType', async () => {
    const result = await useCase.execute({ envelope: buildEnvelope({ payload: {} }), origin: 'REMOTE' });

    expect(result.outcome).toBe('INVALID_PAYLOAD');
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('serverExecutionId')]));
    expect(events.create).not.toHaveBeenCalled();
  });

  it('durably receives a brand-new event and projects it, ending PROCESSED', async () => {
    events.findByEventId.mockResolvedValue(null);
    const created = buildStoredEvent();
    events.create.mockResolvedValue(created);

    const result = await useCase.execute({ envelope: buildEnvelope(), origin: 'REMOTE' });

    expect(events.create).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: orgId, eventId: 'evt_1', origin: 'REMOTE' }),
      expect.anything(),
    );
    expect(projector.project).toHaveBeenCalledWith(created, expect.anything());
    expect(events.update).toHaveBeenCalledWith(created.id, expect.objectContaining({ status: 'PROCESSED' }), expect.anything());
    expect(result.outcome).toBe('PROCESSED');
  });

  it('treats a duplicate eventId already PROCESSED as an idempotent success — never re-projects', async () => {
    events.findByEventId.mockResolvedValue(buildStoredEvent({ status: 'PROCESSED' }));

    const result = await useCase.execute({ envelope: buildEnvelope(), origin: 'REMOTE' });

    expect(result.outcome).toBe('ALREADY_PROCESSED');
    expect(events.create).not.toHaveBeenCalled();
    expect(projector.project).not.toHaveBeenCalled();
  });

  it('treats a duplicate eventId already FAILED_TERMINAL as terminal — never re-projects automatically', async () => {
    events.findByEventId.mockResolvedValue(buildStoredEvent({ status: 'FAILED_TERMINAL' }));

    const result = await useCase.execute({ envelope: buildEnvelope(), origin: 'REMOTE' });

    expect(result.outcome).toBe('FAILED_TERMINAL');
    expect(projector.project).not.toHaveBeenCalled();
  });

  it('re-attempts projection for a duplicate eventId still RECEIVED (crash between Etapa A and B)', async () => {
    events.findByEventId.mockResolvedValue(buildStoredEvent({ status: 'RECEIVED' }));

    const result = await useCase.execute({ envelope: buildEnvelope(), origin: 'REMOTE' });

    expect(events.create).not.toHaveBeenCalled();
    expect(projector.project).toHaveBeenCalled();
    expect(result.outcome).toBe('PROCESSED');
  });

  it('reports ALREADY_PROCESSING when a concurrent delivery already claimed the same event row', async () => {
    events.findByEventId.mockResolvedValue(buildStoredEvent({ status: 'RECEIVED' }));
    events.conditionalClaimForProcessing.mockResolvedValue(0);

    const result = await useCase.execute({ envelope: buildEnvelope(), origin: 'REMOTE' });

    expect(result.outcome).toBe('ALREADY_PROCESSING');
    expect(projector.project).not.toHaveBeenCalled();
    expect(events.update).not.toHaveBeenCalled();
  });

  it('marks a retryable projection failure as FAILED_RETRYABLE and records an audit entry', async () => {
    events.findByEventId.mockResolvedValue(null);
    const created = buildStoredEvent({ attempts: 0 });
    events.create.mockResolvedValue(created);
    projector.project.mockRejectedValue(new MotorEventProjectionError('boom', true, 'OUTBOUND_MESSAGE_NOT_FOUND'));

    const result = await useCase.execute({ envelope: buildEnvelope(), origin: 'REMOTE' });

    expect(result.outcome).toBe('FAILED_RETRYABLE');
    expect(events.update).toHaveBeenCalledWith(
      created.id,
      expect.objectContaining({ status: 'FAILED_RETRYABLE', errorCode: 'OUTBOUND_MESSAGE_NOT_FOUND', attempts: 1 }),
    );
    expect(auditLogs.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'integration_event.projection_failed', organizationId: orgId }),
    );
  });

  it('marks a non-retryable projection failure as FAILED_TERMINAL immediately, regardless of attempt count', async () => {
    events.findByEventId.mockResolvedValue(null);
    const created = buildStoredEvent();
    events.create.mockResolvedValue(created);
    projector.project.mockRejectedValue(new MotorEventProjectionError('not found', false, 'EXECUTION_NOT_FOUND'));

    const result = await useCase.execute({ envelope: buildEnvelope(), origin: 'REMOTE' });

    expect(result.outcome).toBe('FAILED_TERMINAL');
    expect(events.update).toHaveBeenCalledWith(created.id, expect.objectContaining({ status: 'FAILED_TERMINAL', errorCode: 'EXECUTION_NOT_FOUND' }));
  });

  it('defaults an unclassified error to retryable — never assumes terminal without evidence', async () => {
    events.findByEventId.mockResolvedValue(null);
    const created = buildStoredEvent();
    events.create.mockResolvedValue(created);
    projector.project.mockRejectedValue(new Error('unexpected'));

    const result = await useCase.execute({ envelope: buildEnvelope(), origin: 'REMOTE' });

    expect(result.outcome).toBe('FAILED_RETRYABLE');
    expect(events.update).toHaveBeenCalledWith(created.id, expect.objectContaining({ status: 'FAILED_RETRYABLE', errorCode: 'UNEXPECTED_ERROR' }));
  });

  it('downgrades a retryable failure to FAILED_TERMINAL once MAX_PROJECTION_ATTEMPTS is reached', async () => {
    const nearLimitEvent = buildStoredEvent({ status: 'FAILED_RETRYABLE', attempts: MAX_PROJECTION_ATTEMPTS - 1 });
    projector.project.mockRejectedValue(new MotorEventProjectionError('still broken', true, 'SOME_TRANSIENT_ERROR'));

    const result = await useCase.attemptProjection(nearLimitEvent);

    expect(result.outcome).toBe('FAILED_TERMINAL');
    expect(events.update).toHaveBeenCalledWith(
      nearLimitEvent.id,
      expect.objectContaining({ status: 'FAILED_TERMINAL', attempts: MAX_PROJECTION_ATTEMPTS }),
    );
  });

  it('reuses attemptProjection as the manual-retry entry point for a FAILED_RETRYABLE event', async () => {
    const retryable = buildStoredEvent({ status: 'FAILED_RETRYABLE', attempts: 1 });

    const result = await useCase.attemptProjection(retryable);

    expect(events.conditionalClaimForProcessing).toHaveBeenCalledWith(retryable.id);
    expect(result.outcome).toBe('PROCESSED');
  });
});
