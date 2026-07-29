import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { UpdateSequenceExecutionInput } from '../../domain/sequence-execution/sequence-execution.entity';
import { SequenceExecutionRepository } from '../../domain/sequence-execution/sequence-execution.repository';
import { AUDIT_LOG_REPOSITORY, SEQUENCE_EXECUTION_REPOSITORY } from '../../infrastructure/persistence/tokens';
import { SimulatableExecutionState, SimulateExecutionStateDto } from '../../modules/sequence-executions/dto/simulate-execution-state.dto';
import { SequenceExecutionsService } from './sequence-executions.service';
import { SequenceExecutionSummary } from './sequence-executions.types';

/** Demo-neutral, coherent with a 100-prospect base — never real commercial data (§5 of the request). */
const COMPLETED_METRICS = {
  receivedProspects: 100,
  acceptedProspects: 96,
  sentCount: 250,
  pendingCount: 0,
  failedCount: 4,
  currentStepNumber: 3,
};

/** "Partial progress interrupted by a failure" — smaller than COMPLETED's totals, never "everything sent". */
const FAILED_METRICS = {
  receivedProspects: 100,
  acceptedProspects: 96,
  sentCount: 58,
  pendingCount: 34,
  failedCount: 4,
  currentStepNumber: 2,
};

const DEFAULT_FAILED_MESSAGE = 'Simulación: fallo de entrega simulado para validación visual.';
const DEFAULT_REJECTED_MESSAGE = 'Simulación: la cuenta no estaba disponible o la plantilla ya no era válida.';

function sanitize(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed.slice(0, 500) : fallback;
}

function auditActionAndEventType(status: SimulatableExecutionState): { action: string; eventType: string } {
  switch (status) {
    case 'COMPLETED':
      return { action: 'sequence_execution.simulated_completed', eventType: 'SIMULATED_EXECUTION_COMPLETED' };
    case 'FAILED':
      return { action: 'sequence_execution.simulated_failed', eventType: 'SIMULATED_EXECUTION_FAILED' };
    case 'REJECTED':
      return { action: 'sequence_execution.simulated_rejected', eventType: 'SIMULATED_EXECUTION_REJECTED' };
    default:
      return { action: 'sequence_execution.simulated_status_changed', eventType: 'SIMULATED_EXECUTION_STATUS_CHANGED' };
  }
}

/**
 * Dev-only tool (never reachable when `SEQUENCE_MOTOR_MODE=http` or
 * `NODE_ENV=production` — enforced by the controller, not here) that lets
 * a local/demo environment force a Gestión into any terminal or in-flight
 * state without a real Railway round-trip. Exists solely so the
 * Borradores/En ejecución/Finalizadas/Con problemas tabs can be
 * visually validated end-to-end before the real motor is connected —
 * see DevSimulatedExecutionsController's class doc for the full gating
 * rationale. Never touches `SimulatedSequenceExecutionMotorAdapter`'s own
 * registry/idempotency state and never calls out to any motor port —
 * purely a direct, local mutation of this one Gestión's own row.
 */
@Injectable()
export class DevSimulatedExecutionStateService {
  constructor(
    @Inject(SEQUENCE_EXECUTION_REPOSITORY) private readonly executions: SequenceExecutionRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
    private readonly executionsService: SequenceExecutionsService,
  ) {}

  async apply(
    organizationId: string,
    actorId: string,
    executionId: string,
    input: SimulateExecutionStateDto,
  ): Promise<SequenceExecutionSummary> {
    const execution = await this.executions.findById(executionId);
    if (!execution || execution.organizationId !== organizationId) {
      throw new NotFoundException('Gestión no encontrada.');
    }

    const previousStatus = execution.status;
    const previousServerStatus = execution.serverStatus;
    const now = new Date();
    const patch: UpdateSequenceExecutionInput = { lastSyncedAt: now };
    let reason: string | null = null;

    switch (input.status) {
      case 'QUEUED':
        // §11/refresh-execution-status.use-case.ts: QUEUED is always a serverStatus nested under local ACCEPTED, never its own local state.
        patch.status = 'ACCEPTED';
        patch.serverStatus = 'QUEUED';
        patch.receivedAt = execution.receivedAt ?? now;
        break;
      case 'ACCEPTED':
        patch.status = 'ACCEPTED';
        patch.serverStatus = 'QUEUED';
        patch.receivedAt = execution.receivedAt ?? now;
        break;
      case 'RUNNING':
        patch.status = 'RUNNING';
        patch.serverStatus = 'RUNNING';
        patch.receivedAt = execution.receivedAt ?? now;
        patch.startedAt = execution.startedAt ?? now;
        patch.currentStepNumber = execution.currentStepNumber ?? 1;
        break;
      case 'COMPLETED':
        // Always the full, internally-coherent demo bundle (§5 of the request gives fixed
        // example numbers) — never mixed field-by-field with whatever partial data this
        // Gestión happened to already have, which could otherwise produce nonsense like
        // "250 sent" next to a real "2 accepted".
        patch.status = 'COMPLETED';
        patch.serverStatus = 'COMPLETED';
        patch.receivedAt = execution.receivedAt ?? now;
        patch.startedAt = execution.startedAt ?? now;
        patch.completedAt = now;
        patch.receivedProspects = COMPLETED_METRICS.receivedProspects;
        patch.acceptedProspects = COMPLETED_METRICS.acceptedProspects;
        patch.currentStepNumber = COMPLETED_METRICS.currentStepNumber;
        patch.sentCount = COMPLETED_METRICS.sentCount;
        patch.pendingCount = COMPLETED_METRICS.pendingCount;
        patch.failedCount = COMPLETED_METRICS.failedCount;
        patch.lastError = null;
        break;
      case 'FAILED': {
        // "Mantén los conteos alcanzados antes del fallo" (§5): if this Gestión already had
        // real in-flight send counts (e.g. from an earlier refresh-status call), keep that
        // whole bundle untouched — only stamp failedAt/lastError. Otherwise there is no real
        // progress to preserve, so apply one coherent fabricated partial-progress bundle
        // (never field-by-field mixed with unrelated real values).
        const hasRealProgress = execution.sentCount !== null || execution.pendingCount !== null || execution.failedCount !== null;
        reason = sanitize(input.errorMessage, DEFAULT_FAILED_MESSAGE);
        patch.status = 'FAILED';
        patch.serverStatus = 'FAILED';
        patch.receivedAt = execution.receivedAt ?? now;
        patch.startedAt = execution.startedAt ?? now;
        patch.failedAt = now;
        patch.receivedProspects = hasRealProgress ? execution.receivedProspects : FAILED_METRICS.receivedProspects;
        patch.acceptedProspects = hasRealProgress ? execution.acceptedProspects : FAILED_METRICS.acceptedProspects;
        patch.currentStepNumber = hasRealProgress ? execution.currentStepNumber : FAILED_METRICS.currentStepNumber;
        patch.sentCount = hasRealProgress ? execution.sentCount : FAILED_METRICS.sentCount;
        patch.pendingCount = hasRealProgress ? execution.pendingCount : FAILED_METRICS.pendingCount;
        patch.failedCount = hasRealProgress ? execution.failedCount : FAILED_METRICS.failedCount;
        patch.lastError = reason;
        break;
      }
      case 'REJECTED':
        reason = sanitize(input.errorMessage, DEFAULT_REJECTED_MESSAGE);
        patch.status = 'REJECTED';
        patch.serverStatus = 'REJECTED';
        // §5 — a rejection never simulates any send activity: no receivedAt/startedAt, zeroed counts.
        patch.receivedProspects = 0;
        patch.acceptedProspects = 0;
        patch.rejectedProspects = execution.receivedProspects ?? 0;
        patch.sentCount = 0;
        patch.pendingCount = 0;
        patch.failedCount = 0;
        patch.lastError = reason;
        break;
    }

    const updated = await this.executions.update(executionId, patch);

    const { action, eventType } = auditActionAndEventType(input.status);
    await this.audit.record({
      organizationId,
      actorId,
      action,
      entityType: 'SequenceExecution',
      entityId: executionId,
      metadata: {
        source: 'SIMULATED_DEV_TOOL',
        eventType,
        previousStatus,
        previousServerStatus,
        newStatus: updated.status,
        newServerStatus: updated.serverStatus,
        simulatedRequestedState: input.status,
        errorCode: input.errorCode ?? null,
        reason,
      },
    });

    return this.executionsService.getAny(organizationId, executionId);
  }
}
