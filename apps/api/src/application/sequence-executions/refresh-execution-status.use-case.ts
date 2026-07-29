import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { SequenceExecutionStatus } from '../../domain/sequence-execution/sequence-execution.entity';
import { SequenceExecutionRepository } from '../../domain/sequence-execution/sequence-execution.repository';
import {
  SEQUENCE_EXECUTION_MOTOR_PORT,
  SequenceExecutionMotorPort,
} from '../../domain/sequence-execution-motor/sequence-execution-motor-port';
import { SequenceExecutionServerStatus } from '../../domain/sequence-execution-motor/sequence-execution-motor.types';
import { AUDIT_LOG_REPOSITORY, SEQUENCE_EXECUTION_REPOSITORY } from '../../infrastructure/persistence/tokens';
import { SequenceExecutionsService } from './sequence-executions.service';
import { SequenceExecutionSummary } from './sequence-executions.types';

/** §11 — a server-reported QUEUED status collapses into the local ACCEPTED bucket: it is the server's own internal bookkeeping, surfaced verbatim via `serverStatus`, never a distinct decision Mr Outreach made. */
const LOCAL_STATUS_FOR_SERVER_STATUS: Record<SequenceExecutionServerStatus, SequenceExecutionStatus> = {
  QUEUED: 'ACCEPTED',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  REJECTED: 'REJECTED',
};

/** §13 — read-only against the motor: never mutates account/mailbox/template/mapping, only the server-status snapshot fields (including the real startedAt/completedAt/failedAt instants once the server reports them). */
@Injectable()
export class RefreshExecutionStatusUseCase {
  constructor(
    @Inject(SEQUENCE_EXECUTION_REPOSITORY) private readonly executions: SequenceExecutionRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
    @Inject(SEQUENCE_EXECUTION_MOTOR_PORT) private readonly motor: SequenceExecutionMotorPort,
    private readonly executionsService: SequenceExecutionsService,
  ) {}

  async execute(organizationId: string, actorId: string, executionId: string): Promise<SequenceExecutionSummary> {
    const execution = await this.executions.findById(executionId);
    if (!execution || execution.organizationId !== organizationId) {
      throw new NotFoundException('Gestión no encontrada.');
    }
    if (!execution.serverExecutionId) {
      throw new ConflictException('Esta gestión todavía no fue enviada al servidor.');
    }

    try {
      const snapshot = await this.motor.getExecutionStatus(execution.serverExecutionId);
      const nextStatus = LOCAL_STATUS_FOR_SERVER_STATUS[snapshot.status];
      const justStarted = !execution.startedAt && Boolean(snapshot.startedAt);
      await this.executions.update(execution.id, {
        serverStatus: snapshot.status,
        currentStepNumber: snapshot.currentStepNumber,
        sentCount: snapshot.sentCount,
        pendingCount: snapshot.pendingCount,
        failedCount: snapshot.failedCount,
        estimatedStartAt: snapshot.estimatedStartAt,
        lastError: snapshot.lastError,
        lastSyncedAt: snapshot.checkedAt,
        status: nextStatus,
        // §2 — real events, set exactly once, the first time the server actually reports them.
        startedAt: execution.startedAt ?? snapshot.startedAt,
        completedAt: execution.completedAt ?? (nextStatus === 'COMPLETED' ? snapshot.checkedAt : null),
        failedAt: execution.failedAt ?? (nextStatus === 'FAILED' ? snapshot.checkedAt : null),
      });
      await this.audit.record({
        organizationId,
        actorId,
        action: 'sequence_execution.status_refreshed',
        entityType: 'SequenceExecution',
        entityId: execution.id,
        metadata: { serverStatus: snapshot.status },
      });
      if (justStarted) {
        await this.audit.record({
          organizationId,
          actorId,
          action: 'sequence_execution.started',
          entityType: 'SequenceExecution',
          entityId: execution.id,
          metadata: { startedAt: snapshot.startedAt },
        });
      }
    } catch (error) {
      await this.audit.record({
        organizationId,
        actorId,
        action: 'sequence_execution.status_refresh_failed',
        entityType: 'SequenceExecution',
        entityId: execution.id,
        metadata: { error: error instanceof Error ? error.message : 'unknown' },
      });
      throw error;
    }

    return this.executionsService.getAny(organizationId, execution.id);
  }
}
