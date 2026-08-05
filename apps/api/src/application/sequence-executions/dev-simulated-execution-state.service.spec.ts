import { NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { SequenceExecution } from '../../domain/sequence-execution/sequence-execution.entity';
import { SequenceExecutionRepository } from '../../domain/sequence-execution/sequence-execution.repository';
import { SimulateExecutionStateDto } from '../../modules/sequence-executions/dto/simulate-execution-state.dto';
import { DevSimulatedExecutionStateService } from './dev-simulated-execution-state.service';
import { SequenceExecutionsService } from './sequence-executions.service';

describe('DevSimulatedExecutionStateService', () => {
  let executions: jest.Mocked<Pick<SequenceExecutionRepository, 'findById' | 'update'>>;
  let audit: jest.Mocked<Pick<AuditLogRepository, 'record'>>;
  let executionsService: jest.Mocked<Pick<SequenceExecutionsService, 'getAny'>>;
  let service: DevSimulatedExecutionStateService;

  const orgId = 'org_1';
  const otherOrgId = 'org_2';
  const actorId = 'admin_1';
  const executionId = 'run_1';

  const baseExecution: SequenceExecution = {
    id: executionId,
    organizationId: orgId,
    executiveId: 'exec_1',
    mailboxId: 'mailbox_1',
    templateId: 'template_1',
    templateVersionId: 'version_1',
    name: 'Gestión_29072026',
    timezone: 'America/Santiago',
    status: 'ACCEPTED',
    prospectImportId: null,
    requestedAt: new Date('2026-07-29T15:00:00Z'),
    receivedAt: new Date('2026-07-29T15:00:05Z'),
    estimatedStartAt: null,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    serverStatus: 'QUEUED',
    currentStepNumber: null,
    sentCount: null,
    pendingCount: null,
    failedCount: null,
    receivedProspects: 2,
    acceptedProspects: 2,
    rejectedProspects: 0,
    initialProspectState: 'STEP_01_PENDING',
    lastSyncedAt: new Date('2026-07-29T15:00:05Z'),
    lastError: null,
    serverExecutionId: 'exec_srv_1',
    executionTokenCiphertext: null,
    lastSubmissionIdempotencyKey: 'idem_1',
    pausedAt: null,
    resumedAt: null,
    stoppedAt: null,
    stopReason: null,
    lastControlIdempotencyKey: null,
    executionAttempt: 1,
    previousExecutionId: null,
    createdBy: 'exec_1',
    createdAt: new Date('2026-07-29T14:59:00Z'),
    updatedAt: new Date('2026-07-29T15:00:05Z'),
  };

  beforeEach(() => {
    executions = {
      findById: jest.fn().mockResolvedValue(baseExecution),
      update: jest.fn().mockImplementation((_id, patch) => Promise.resolve({ ...baseExecution, ...patch })),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    executionsService = { getAny: jest.fn().mockResolvedValue({ id: executionId, status: 'COMPLETED' }) };

    service = new DevSimulatedExecutionStateService(
      executions as unknown as SequenceExecutionRepository,
      audit as unknown as AuditLogRepository,
      executionsService as unknown as SequenceExecutionsService,
    );
  });

  it('rejects a Gestión belonging to another organization (tenant isolation)', async () => {
    executions.findById.mockResolvedValue({ ...baseExecution, organizationId: otherOrgId });
    await expect(service.apply(orgId, actorId, executionId, { status: 'COMPLETED' } as SimulateExecutionStateDto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(executions.update).not.toHaveBeenCalled();
  });

  it('rejects an execution that does not exist', async () => {
    executions.findById.mockResolvedValue(null);
    await expect(service.apply(orgId, actorId, executionId, { status: 'COMPLETED' } as SimulateExecutionStateDto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('COMPLETED stamps completedAt and fills in coherent demo metrics without inventing a future timestamp', async () => {
    const before = Date.now();
    await service.apply(orgId, actorId, executionId, { status: 'COMPLETED' } as SimulateExecutionStateDto);
    const patch = executions.update.mock.calls[0][1];
    expect(patch.status).toBe('COMPLETED');
    expect(patch.serverStatus).toBe('COMPLETED');
    expect(patch.completedAt).toBeInstanceOf(Date);
    expect((patch.completedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect(patch.sentCount).toBe(250);
    expect(patch.pendingCount).toBe(0);
    expect(patch.failedCount).toBe(4);
    expect(patch.lastError).toBeNull();
  });

  it('FAILED keeps the counts already reached before the failure instead of overwriting them', async () => {
    executions.findById.mockResolvedValue({ ...baseExecution, sentCount: 12, pendingCount: 88, failedCount: 0 });
    await service.apply(orgId, actorId, executionId, {
      status: 'FAILED',
      errorMessage: 'Fallo simulado para validación visual',
    } as SimulateExecutionStateDto);
    const patch = executions.update.mock.calls[0][1];
    expect(patch.status).toBe('FAILED');
    expect(patch.serverStatus).toBe('FAILED');
    expect(patch.failedAt).toBeInstanceOf(Date);
    expect(patch.sentCount).toBe(12);
    expect(patch.pendingCount).toBe(88);
    expect(patch.lastError).toBe('Fallo simulado para validación visual');
  });

  it('FAILED without a prior in-flight state falls back to a coherent partial-progress default (never "everything sent")', async () => {
    await service.apply(orgId, actorId, executionId, { status: 'FAILED' } as SimulateExecutionStateDto);
    const patch = executions.update.mock.calls[0][1];
    expect(patch.sentCount).toBeLessThan(patch.receivedProspects as number);
    expect(patch.lastError).toContain('Simulación');
  });

  it('REJECTED never simulates any send activity and zeroes every send-related count', async () => {
    await service.apply(orgId, actorId, executionId, {
      status: 'REJECTED',
      errorMessage: 'Cuenta no disponible (simulado)',
    } as SimulateExecutionStateDto);
    const patch = executions.update.mock.calls[0][1];
    expect(patch.status).toBe('REJECTED');
    expect(patch.serverStatus).toBe('REJECTED');
    expect(patch.sentCount).toBe(0);
    expect(patch.pendingCount).toBe(0);
    expect(patch.acceptedProspects).toBe(0);
    expect(patch.lastError).toBe('Cuenta no disponible (simulado)');
    expect(patch.startedAt).toBeUndefined();
  });

  it('QUEUED maps onto local ACCEPTED with serverStatus QUEUED, mirroring RefreshExecutionStatusUseCase\'s own contract', async () => {
    await service.apply(orgId, actorId, executionId, { status: 'QUEUED' } as SimulateExecutionStateDto);
    const patch = executions.update.mock.calls[0][1];
    expect(patch.status).toBe('ACCEPTED');
    expect(patch.serverStatus).toBe('QUEUED');
  });

  it('records the transition as SIMULATED_DEV_TOOL-sourced audit metadata, never mixed with real motor responses', async () => {
    await service.apply(orgId, actorId, executionId, { status: 'COMPLETED' } as SimulateExecutionStateDto);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: orgId,
        actorId,
        action: 'sequence_execution.simulated_completed',
        entityType: 'SequenceExecution',
        entityId: executionId,
        metadata: expect.objectContaining({
          source: 'SIMULATED_DEV_TOOL',
          eventType: 'SIMULATED_EXECUTION_COMPLETED',
          previousStatus: 'ACCEPTED',
          newStatus: 'COMPLETED',
        }),
      }),
    );
  });

  it('uses SIMULATED_EXECUTION_FAILED/_REJECTED/_STATUS_CHANGED event types for their respective transitions', async () => {
    await service.apply(orgId, actorId, executionId, { status: 'FAILED' } as SimulateExecutionStateDto);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ eventType: 'SIMULATED_EXECUTION_FAILED' }) }));

    await service.apply(orgId, actorId, executionId, { status: 'REJECTED' } as SimulateExecutionStateDto);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ eventType: 'SIMULATED_EXECUTION_REJECTED' }) }));

    await service.apply(orgId, actorId, executionId, { status: 'RUNNING' } as SimulateExecutionStateDto);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ eventType: 'SIMULATED_EXECUTION_STATUS_CHANGED' }) }));
  });

  it('never depends on any SequenceExecutionMotorPort — structurally impossible to reach Railway from this service', () => {
    // Only (executions repository, audit log, executionsService) are constructor params —
    // no SequenceExecutionMotorPort/HTTP client dependency exists to route a call through.
    expect(DevSimulatedExecutionStateService.length).toBe(3);
  });
});
