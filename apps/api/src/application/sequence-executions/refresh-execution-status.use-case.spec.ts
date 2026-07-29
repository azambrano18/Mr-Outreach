import { ConflictException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { SequenceExecutionRepository } from '../../domain/sequence-execution/sequence-execution.repository';
import { SequenceExecutionMotorPort } from '../../domain/sequence-execution-motor/sequence-execution-motor-port';
import { RefreshExecutionStatusUseCase } from './refresh-execution-status.use-case';
import { SequenceExecutionsService } from './sequence-executions.service';

describe('RefreshExecutionStatusUseCase', () => {
  let executions: jest.Mocked<Pick<SequenceExecutionRepository, 'findById' | 'update'>>;
  let audit: jest.Mocked<Pick<AuditLogRepository, 'record'>>;
  let motor: jest.Mocked<Pick<SequenceExecutionMotorPort, 'getExecutionStatus'>>;
  let executionsService: jest.Mocked<Pick<SequenceExecutionsService, 'getAny'>>;
  let useCase: RefreshExecutionStatusUseCase;

  const orgId = 'org_1';
  const actorId = 'exec_1';
  const executionId = 'run_1';

  const queuedExecution = {
    id: executionId,
    organizationId: orgId,
    serverExecutionId: 'srv_exec_1',
    startedAt: null,
    completedAt: null,
    failedAt: null,
  };

  beforeEach(() => {
    executions = { findById: jest.fn().mockResolvedValue(queuedExecution), update: jest.fn().mockResolvedValue(queuedExecution) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    motor = { getExecutionStatus: jest.fn() };
    executionsService = { getAny: jest.fn().mockResolvedValue({ id: executionId, status: 'RUNNING' }) };

    useCase = new RefreshExecutionStatusUseCase(
      executions as unknown as SequenceExecutionRepository,
      audit as unknown as AuditLogRepository,
      motor as unknown as SequenceExecutionMotorPort,
      executionsService as unknown as SequenceExecutionsService,
    );
  });

  it('rejects refreshing a Gestión that was never submitted to the server', async () => {
    executions.findById.mockResolvedValue({ ...queuedExecution, serverExecutionId: null } as any);
    await expect(useCase.execute(orgId, actorId, executionId)).rejects.toBeInstanceOf(ConflictException);
  });

  it('maps QUEUED/RUNNING/COMPLETED/FAILED/REJECTED server statuses onto the same local status names', async () => {
    motor.getExecutionStatus.mockResolvedValue({
      serverExecutionId: 'srv_exec_1',
      status: 'RUNNING',
      currentStepNumber: 2,
      sentCount: 10,
      pendingCount: 5,
      failedCount: 0,
      estimatedStartAt: null,
      startedAt: new Date('2026-07-28T18:30:00Z'),
      lastError: null,
      checkedAt: new Date('2026-07-28T18:35:00Z'),
    });
    await useCase.execute(orgId, actorId, executionId);
    expect(executions.update).toHaveBeenCalledWith(executionId, expect.objectContaining({ status: 'RUNNING', serverStatus: 'RUNNING' }));
  });

  it('stamps startedAt exactly once and records EXECUTION_STARTED the first time the server reports it', async () => {
    motor.getExecutionStatus.mockResolvedValue({
      serverExecutionId: 'srv_exec_1',
      status: 'RUNNING',
      currentStepNumber: 1,
      sentCount: 0,
      pendingCount: 10,
      failedCount: 0,
      estimatedStartAt: null,
      startedAt: new Date('2026-07-28T18:30:00Z'),
      lastError: null,
      checkedAt: new Date('2026-07-28T18:35:00Z'),
    });
    await useCase.execute(orgId, actorId, executionId);
    expect(executions.update).toHaveBeenCalledWith(executionId, expect.objectContaining({ startedAt: new Date('2026-07-28T18:30:00Z') }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'sequence_execution.started' }));
  });

  it('does not re-record EXECUTION_STARTED once startedAt is already set', async () => {
    executions.findById.mockResolvedValue({ ...queuedExecution, startedAt: new Date('2026-07-28T18:30:00Z') } as any);
    motor.getExecutionStatus.mockResolvedValue({
      serverExecutionId: 'srv_exec_1',
      status: 'RUNNING',
      currentStepNumber: 2,
      sentCount: 3,
      pendingCount: 7,
      failedCount: 0,
      estimatedStartAt: null,
      startedAt: new Date('2026-07-28T18:30:00Z'),
      lastError: null,
      checkedAt: new Date('2026-07-28T19:00:00Z'),
    });
    await useCase.execute(orgId, actorId, executionId);
    expect(audit.record).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'sequence_execution.started' }));
  });

  it('stamps completedAt when the server reports COMPLETED', async () => {
    motor.getExecutionStatus.mockResolvedValue({
      serverExecutionId: 'srv_exec_1',
      status: 'COMPLETED',
      currentStepNumber: 3,
      sentCount: 10,
      pendingCount: 0,
      failedCount: 0,
      estimatedStartAt: null,
      startedAt: new Date('2026-07-28T18:30:00Z'),
      lastError: null,
      checkedAt: new Date('2026-07-28T20:00:00Z'),
    });
    await useCase.execute(orgId, actorId, executionId);
    expect(executions.update).toHaveBeenCalledWith(
      executionId,
      expect.objectContaining({ status: 'COMPLETED', completedAt: new Date('2026-07-28T20:00:00Z') }),
    );
  });

  it('audits a refresh failure and rethrows when the motor is unreachable', async () => {
    motor.getExecutionStatus.mockRejectedValue(new Error('unreachable'));
    await expect(useCase.execute(orgId, actorId, executionId)).rejects.toThrow('unreachable');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'sequence_execution.status_refresh_failed' }));
  });
});
