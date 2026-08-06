import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { IntegrationCommandRepository } from '../../domain/integration/integration-command.repository';
import { TransactionContext, TransactionManager } from '../../domain/persistence/transaction';
import { SequenceExecution, SequenceExecutionStatus } from '../../domain/sequence-execution/sequence-execution.entity';
import { SequenceExecutionRepository } from '../../domain/sequence-execution/sequence-execution.repository';
import { SequenceExecutionMotorPort } from '../../domain/sequence-execution-motor/sequence-execution-motor-port';
import { ExecutionControlCommandResult } from '../../domain/sequence-execution-motor/sequence-execution-motor.types';
import { ProcessMotorEventUseCase } from '../motor-event/process-motor-event.use-case';
import { ControlSequenceExecutionUseCase } from './control-sequence-execution.use-case';
import { SequenceExecutionsService } from './sequence-executions.service';

class FakeTransactionManager implements TransactionManager {
  async run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    return work({ kind: 'fake' });
  }
}

describe('ControlSequenceExecutionUseCase — Fase "Control operativo de Gestiones"', () => {
  let executions: jest.Mocked<
    Pick<SequenceExecutionRepository, 'findById' | 'update' | 'conditionalUpdateStatusFromAllowed'>
  >;
  let audit: jest.Mocked<Pick<AuditLogRepository, 'record'>>;
  let motor: jest.Mocked<Pick<SequenceExecutionMotorPort, 'pauseExecution' | 'resumeExecution' | 'stopExecution'>>;
  let commands: jest.Mocked<Pick<IntegrationCommandRepository, 'findByIdempotencyKey' | 'create' | 'update'>>;
  let executionsService: jest.Mocked<Pick<SequenceExecutionsService, 'getAny'>>;
  let processEvent: jest.Mocked<Pick<ProcessMotorEventUseCase, 'execute'>>;
  let useCase: ControlSequenceExecutionUseCase;

  const orgId = 'org_1';
  const otherOrgId = 'org_2';
  const executionId = 'exec_1';

  function buildExecution(overrides: Partial<SequenceExecution> = {}): SequenceExecution {
    return {
      id: executionId,
      organizationId: orgId,
      executiveId: 'exec_user_1',
      mailboxId: 'mailbox_1',
      templateId: 'template_1',
      templateVersionId: 'version_1',
      name: 'Gestión_05082026',
      timezone: 'America/Santiago',
      status: 'RUNNING',
      prospectImportId: 'import_1',
      requestedAt: new Date(),
      receivedAt: new Date(),
      estimatedStartAt: null,
      startedAt: new Date(),
      completedAt: null,
      failedAt: null,
      serverStatus: 'RUNNING',
      currentStepNumber: 1,
      sentCount: 2,
      pendingCount: 3,
      failedCount: 0,
      receivedProspects: 5,
      acceptedProspects: 5,
      rejectedProspects: 0,
      initialProspectState: 'STEP_01_PENDING',
      lastSyncedAt: new Date(),
      lastError: null,
      serverExecutionId: 'srv_exec_1',
      executionTokenCiphertext: null,
      lastSubmissionIdempotencyKey: null,
      pausedAt: null,
      resumedAt: null,
      stoppedAt: null,
      stopReason: null,
      lastControlIdempotencyKey: null,
      executionAttempt: 1,
      previousExecutionId: null,
      createdBy: 'exec_user_1',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  function acceptedControlResult(): ExecutionControlCommandResult {
    return { accepted: true, status: 'ACCEPTED', rejectionReason: null, acknowledgedAt: new Date() };
  }

  beforeEach(() => {
    executions = {
      findById: jest.fn().mockResolvedValue(buildExecution()),
      update: jest.fn().mockImplementation((_id, patch) => Promise.resolve({ ...buildExecution(), ...patch })),
      conditionalUpdateStatusFromAllowed: jest.fn().mockResolvedValue(1),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    motor = {
      pauseExecution: jest.fn().mockResolvedValue(acceptedControlResult()),
      resumeExecution: jest.fn().mockResolvedValue(acceptedControlResult()),
      stopExecution: jest.fn().mockResolvedValue(acceptedControlResult()),
    };
    commands = {
      findByIdempotencyKey: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'cmdrow_1', commandId: 'cmd_1' }),
      update: jest.fn().mockResolvedValue(undefined),
    };
    executionsService = {
      getAny: jest.fn().mockResolvedValue({ id: executionId, status: 'PAUSED' }),
    };
    processEvent = { execute: jest.fn().mockResolvedValue(undefined) };

    useCase = new ControlSequenceExecutionUseCase(
      executions as unknown as SequenceExecutionRepository,
      audit as unknown as AuditLogRepository,
      motor as unknown as SequenceExecutionMotorPort,
      new FakeTransactionManager(),
      commands as unknown as IntegrationCommandRepository,
      executionsService as unknown as SequenceExecutionsService,
      processEvent as unknown as ProcessMotorEventUseCase,
    );
  });

  function baseInput(overrides: Partial<Parameters<ControlSequenceExecutionUseCase['execute']>[0]> = {}) {
    return {
      organizationId: orgId,
      actorId: 'admin_1',
      executionId,
      action: 'PAUSE' as const,
      idempotencyKey: 'idem_1',
      ...overrides,
    };
  }

  describe('PAUSE', () => {
    it('claims RUNNING -> PAUSE_REQUESTED, calls the motor, and lands on PAUSED once accepted', async () => {
      await useCase.execute(baseInput());

      expect(executions.conditionalUpdateStatusFromAllowed).toHaveBeenNthCalledWith(1, executionId, ['RUNNING'], 'PAUSE_REQUESTED', expect.anything());
      expect(motor.pauseExecution).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: 'idem_1', localExecutionId: executionId, serverExecutionId: 'srv_exec_1' }),
      );
      expect(executions.conditionalUpdateStatusFromAllowed).toHaveBeenNthCalledWith(2, executionId, ['PAUSE_REQUESTED'], 'PAUSED', expect.anything());
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'sequence_execution.paused', entityId: executionId }),
        expect.anything(),
      );
    });

    it('rejects pausing an execution that is not RUNNING with a 409', async () => {
      executions.findById.mockResolvedValue(buildExecution({ status: 'DRAFT' }));
      await expect(useCase.execute(baseInput())).rejects.toThrow(ConflictException);
      expect(motor.pauseExecution).not.toHaveBeenCalled();
      expect(executions.conditionalUpdateStatusFromAllowed).not.toHaveBeenCalled();
    });

    it('idempotent no-op: a verified retry (matching lastControlIdempotencyKey) of an already-PAUSED execution returns success without calling the motor again', async () => {
      executions.findById.mockResolvedValue(buildExecution({ status: 'PAUSED', lastControlIdempotencyKey: 'idem_1' }));
      const result = await useCase.execute(baseInput({ idempotencyKey: 'idem_1' }));
      expect(motor.pauseExecution).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(result).toEqual({ id: executionId, status: 'PAUSED' });
    });

    it('a fresh pause call (different idempotencyKey) on an already-PAUSED execution is rejected with a 409, not a silent no-op', async () => {
      executions.findById.mockResolvedValue(buildExecution({ status: 'PAUSED', lastControlIdempotencyKey: 'some_other_key' }));
      await expect(useCase.execute(baseInput({ idempotencyKey: 'idem_1' }))).rejects.toThrow(ConflictException);
      expect(motor.pauseExecution).not.toHaveBeenCalled();
    });

    it('a retry while already PAUSE_REQUESTED (same idempotencyKey) skips the first claim and calls the motor again', async () => {
      executions.findById.mockResolvedValue(buildExecution({ status: 'PAUSE_REQUESTED', lastControlIdempotencyKey: 'idem_1' }));
      await useCase.execute(baseInput({ idempotencyKey: 'idem_1' }));
      expect(motor.pauseExecution).toHaveBeenCalled();
      // Only the terminal claim runs on a retry — the first (RUNNING -> PAUSE_REQUESTED) claim is skipped since it already happened.
      expect(executions.conditionalUpdateStatusFromAllowed).toHaveBeenCalledTimes(1);
      expect(executions.conditionalUpdateStatusFromAllowed).toHaveBeenCalledWith(executionId, ['PAUSE_REQUESTED'], 'PAUSED', expect.anything());
    });

    it('when the motor rejects the pause, reverts to RUNNING and throws a 409 with the rejection reason', async () => {
      motor.pauseExecution.mockResolvedValue({ accepted: false, status: 'REJECTED', rejectionReason: 'La gestión ya finalizó en el motor.', acknowledgedAt: null });
      await expect(useCase.execute(baseInput())).rejects.toThrow(ConflictException);
      expect(executions.update).toHaveBeenCalledWith(executionId, expect.objectContaining({ status: 'RUNNING' }), expect.anything());
    });

    it('when the motor is unreachable, leaves the execution at PAUSE_REQUESTED (never silently reverted) and rethrows', async () => {
      motor.pauseExecution.mockRejectedValue(new ServiceUnavailableException('El motor no está disponible.'));
      await expect(useCase.execute(baseInput())).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(executions.update).not.toHaveBeenCalledWith(executionId, expect.objectContaining({ status: 'RUNNING' }), expect.anything());
    });

    it('a double-click race on the terminal claim only lets the winner write the audit entry and emit events', async () => {
      executions.conditionalUpdateStatusFromAllowed.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
      await useCase.execute(baseInput());
      expect(audit.record).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'sequence_execution.paused' }), expect.anything());
      expect(processEvent.execute).not.toHaveBeenCalled();
    });

    it('runs the real event pipeline post-commit for EXECUTION_PAUSE_ACCEPTED and EXECUTION_PAUSED', async () => {
      await useCase.execute(baseInput());
      expect(processEvent.execute).toHaveBeenCalledWith(
        expect.objectContaining({ envelope: expect.objectContaining({ eventType: 'EXECUTION_PAUSE_ACCEPTED' }), origin: 'SIMULATED' }),
      );
      expect(processEvent.execute).toHaveBeenCalledWith(
        expect.objectContaining({ envelope: expect.objectContaining({ eventType: 'EXECUTION_PAUSED' }), origin: 'SIMULATED' }),
      );
    });
  });

  describe('RESUME', () => {
    it('claims PAUSED -> RESUME_REQUESTED, calls the motor, and lands on RUNNING once accepted', async () => {
      executions.findById.mockResolvedValue(buildExecution({ status: 'PAUSED' }));
      await useCase.execute(baseInput({ action: 'RESUME' }));
      expect(motor.resumeExecution).toHaveBeenCalled();
      expect(executions.conditionalUpdateStatusFromAllowed).toHaveBeenNthCalledWith(2, executionId, ['RESUME_REQUESTED'], 'RUNNING', expect.anything());
    });

    it('rejects resuming an execution that is RUNNING (not paused) with a 409', async () => {
      await expect(useCase.execute(baseInput({ action: 'RESUME' }))).rejects.toThrow(ConflictException);
      expect(motor.resumeExecution).not.toHaveBeenCalled();
    });
  });

  describe('STOP', () => {
    it('requires a reason between 3 and 300 characters', async () => {
      await expect(useCase.execute(baseInput({ action: 'STOP', reason: 'no' }))).rejects.toThrow(BadRequestException);
      await expect(useCase.execute(baseInput({ action: 'STOP', reason: 'a'.repeat(301) }))).rejects.toThrow(BadRequestException);
      expect(motor.stopExecution).not.toHaveBeenCalled();
    });

    it('allows stopping from RUNNING and from PAUSED', async () => {
      await useCase.execute(baseInput({ action: 'STOP', reason: 'El cliente pidió detener la campaña.' }));
      expect(motor.stopExecution).toHaveBeenCalled();

      executions.findById.mockResolvedValue(buildExecution({ status: 'PAUSED' }));
      await useCase.execute(baseInput({ action: 'STOP', reason: 'El cliente pidió detener la campaña.' }));
      expect(motor.stopExecution).toHaveBeenCalledTimes(2);
    });

    it('persists the reason on the execution row and in the audit trail, and passes it to the motor', async () => {
      await useCase.execute(baseInput({ action: 'STOP', reason: 'Cambio de estrategia comercial.' }));
      expect(executions.update).toHaveBeenCalledWith(
        executionId,
        expect.objectContaining({ stopReason: 'Cambio de estrategia comercial.' }),
        expect.anything(),
      );
      expect(motor.stopExecution).toHaveBeenCalledWith(expect.objectContaining({ reason: 'Cambio de estrategia comercial.' }));
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'sequence_execution.stopped', metadata: expect.objectContaining({ reason: 'Cambio de estrategia comercial.' }) }),
        expect.anything(),
      );
    });

    it('a verified retry (matching lastControlIdempotencyKey) of an already-STOPPED execution is an idempotent no-op, not a 409', async () => {
      executions.findById.mockResolvedValue(buildExecution({ status: 'STOPPED', lastControlIdempotencyKey: 'idem_1' }));
      const result = await useCase.execute(baseInput({ action: 'STOP', reason: 'motivo válido', idempotencyKey: 'idem_1' }));
      expect(motor.stopExecution).not.toHaveBeenCalled();
      expect(result).toEqual({ id: executionId, status: 'PAUSED' });
    });

    it('rejects stopping a DRAFT execution with a 409', async () => {
      executions.findById.mockResolvedValue(buildExecution({ status: 'DRAFT' }));
      await expect(useCase.execute(baseInput({ action: 'STOP', reason: 'motivo válido' }))).rejects.toThrow(ConflictException);
    });

    describe('stopping an ACCEPTED Gestión (accepted by the server, not yet started — real staging case)', () => {
      function buildAcceptedExecution(overrides: Partial<SequenceExecution> = {}): SequenceExecution {
        return buildExecution({
          status: 'ACCEPTED',
          serverStatus: 'QUEUED',
          sentCount: null,
          pendingCount: null,
          failedCount: null,
          startedAt: null,
          acceptedProspects: 13,
          ...overrides,
        });
      }

      it('claims ACCEPTED -> STOP_REQUESTED -> STOPPED and calls the motor', async () => {
        executions.findById.mockResolvedValue(buildAcceptedExecution());
        await useCase.execute(baseInput({ action: 'STOP', reason: 'Detenida antes de iniciar.' }));
        expect(executions.conditionalUpdateStatusFromAllowed).toHaveBeenNthCalledWith(1, executionId, ['RUNNING', 'PAUSED', 'ACCEPTED'], 'STOP_REQUESTED', expect.anything());
        expect(motor.stopExecution).toHaveBeenCalledWith(expect.objectContaining({ serverExecutionId: 'srv_exec_1' }));
        expect(executions.conditionalUpdateStatusFromAllowed).toHaveBeenNthCalledWith(2, executionId, ['STOP_REQUESTED'], 'STOPPED', expect.anything());
      });

      it('marks stoppedBeforeStart, zeroes sentCount/pendingCount, and records the cancelled-prospect count in the audit', async () => {
        executions.findById.mockResolvedValue(buildAcceptedExecution());
        await useCase.execute(baseInput({ action: 'STOP', reason: 'Detenida antes de iniciar.' }));

        expect(executions.update).toHaveBeenCalledWith(
          executionId,
          expect.objectContaining({ sentCount: 0, pendingCount: 0 }),
          expect.anything(),
        );
        expect(audit.record).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'sequence_execution.stopped',
            metadata: expect.objectContaining({
              stoppedBeforeStart: true,
              sentCount: 0,
              cancelledPendingContacts: 13,
              cancelledJobs: 13,
              previousServerStatus: 'QUEUED',
              mailboxId: 'mailbox_1',
            }),
          }),
          expect.anything(),
        );
      });

      it('never marks stoppedBeforeStart when stopping a RUNNING execution', async () => {
        await useCase.execute(baseInput({ action: 'STOP', reason: 'El cliente pidió detener la campaña.' }));
        expect(audit.record).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'sequence_execution.stopped', metadata: expect.objectContaining({ stoppedBeforeStart: false }) }),
          expect.anything(),
        );
        expect(executions.update).not.toHaveBeenCalledWith(executionId, expect.objectContaining({ sentCount: 0 }), expect.anything());
      });

      it('sends no email and never advances currentStepNumber when stopped before start', async () => {
        executions.findById.mockResolvedValue(buildAcceptedExecution());
        await useCase.execute(baseInput({ action: 'STOP', reason: 'Detenida antes de iniciar.' }));
        for (const call of executions.update.mock.calls) {
          expect(call[1]).not.toHaveProperty('currentStepNumber');
        }
      });

      it('when the motor rejects the stop, reverts to ACCEPTED (not RUNNING) using serverStatus QUEUED as the signal', async () => {
        executions.findById.mockResolvedValue(buildAcceptedExecution());
        motor.stopExecution.mockResolvedValue({ accepted: false, status: 'REJECTED', rejectionReason: 'Cuenta de ejecución desconocida para el motor.', acknowledgedAt: null });
        await expect(useCase.execute(baseInput({ action: 'STOP', reason: 'Detenida antes de iniciar.' }))).rejects.toThrow(ConflictException);
        expect(executions.update).toHaveBeenCalledWith(executionId, expect.objectContaining({ status: 'ACCEPTED' }), expect.anything());
      });

      it('emits EXECUTION_STOPPED with stoppedBeforeStart in the event payload', async () => {
        executions.findById.mockResolvedValue(buildAcceptedExecution());
        await useCase.execute(baseInput({ action: 'STOP', reason: 'Detenida antes de iniciar.' }));
        expect(processEvent.execute).toHaveBeenCalledWith(
          expect.objectContaining({
            envelope: expect.objectContaining({
              eventType: 'EXECUTION_STOPPED',
              payload: expect.objectContaining({ stoppedBeforeStart: true, cancelledPendingContacts: 13 }),
            }),
          }),
        );
      });
    });
  });

  describe('cross-cutting', () => {
    it('throws NotFoundException-equivalent (404) when the execution belongs to a different organization', async () => {
      executions.findById.mockResolvedValue(buildExecution({ organizationId: otherOrgId }));
      await expect(useCase.execute(baseInput())).rejects.toThrow();
    });

    it('COMPLETED and FAILED reject every action with a 409', async () => {
      for (const status of ['COMPLETED', 'FAILED'] as SequenceExecutionStatus[]) {
        executions.findById.mockResolvedValue(buildExecution({ status }));
        await expect(useCase.execute(baseInput({ action: 'PAUSE' }))).rejects.toThrow(ConflictException);
        await expect(useCase.execute(baseInput({ action: 'RESUME' }))).rejects.toThrow(ConflictException);
        await expect(useCase.execute(baseInput({ action: 'STOP', reason: 'motivo válido' }))).rejects.toThrow(ConflictException);
      }
    });

    it('STOPPED rejects a fresh STOP (different idempotencyKey) with a 409 instead of silently re-running it', async () => {
      executions.findById.mockResolvedValue(buildExecution({ status: 'STOPPED', lastControlIdempotencyKey: 'some_other_key' }));
      await expect(useCase.execute(baseInput({ action: 'STOP', reason: 'motivo válido', idempotencyKey: 'idem_1' }))).rejects.toThrow(ConflictException);
      expect(motor.stopExecution).not.toHaveBeenCalled();
    });

    it('a double-click race on the STOP terminal claim only lets the winner write the audit entry and emit events', async () => {
      executions.conditionalUpdateStatusFromAllowed.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
      await useCase.execute(baseInput({ action: 'STOP', reason: 'motivo válido' }));
      expect(audit.record).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'sequence_execution.stopped' }), expect.anything());
      expect(processEvent.execute).not.toHaveBeenCalled();
    });
  });
});
