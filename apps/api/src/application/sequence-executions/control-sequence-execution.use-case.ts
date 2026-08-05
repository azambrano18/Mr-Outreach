import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { CommandType } from '../../domain/integration/envelopes';
import { IntegrationCommandRepository } from '../../domain/integration/integration-command.repository';
import { TransactionManager } from '../../domain/persistence/transaction';
import { SequenceExecution, SequenceExecutionStatus } from '../../domain/sequence-execution/sequence-execution.entity';
import { SequenceExecutionRepository } from '../../domain/sequence-execution/sequence-execution.repository';
import {
  SEQUENCE_EXECUTION_MOTOR_PORT,
  SequenceExecutionMotorPort,
} from '../../domain/sequence-execution-motor/sequence-execution-motor-port';
import { ExecutionControlCommandResult } from '../../domain/sequence-execution-motor/sequence-execution-motor.types';
import {
  AUDIT_LOG_REPOSITORY,
  INTEGRATION_COMMAND_REPOSITORY,
  SEQUENCE_EXECUTION_REPOSITORY,
  TRANSACTION_MANAGER,
} from '../../infrastructure/persistence/tokens';
import { buildIdempotencyStorageKey } from '../idempotency/idempotent-operation.service';
import { MotorEventEnvelopeDto, MOTOR_EVENT_SCHEMA_VERSION, MotorEventType } from '../../modules/integration/dto/motor-event-envelope.dto';
import { ProcessMotorEventUseCase } from '../motor-event/process-motor-event.use-case';
import { SequenceExecutionsService } from './sequence-executions.service';
import { SequenceExecutionSummary } from './sequence-executions.types';

export type ControlAction = 'PAUSE' | 'RESUME' | 'STOP';

export interface ControlSequenceExecutionInput {
  organizationId: string;
  actorId: string;
  executionId: string;
  action: ControlAction;
  idempotencyKey: string;
  correlationId?: string;
  /** Required, 3-300 chars, for STOP only — never sent/used for PAUSE/RESUME. */
  reason?: string;
}

interface ControlTransition {
  allowedFrom: SequenceExecutionStatus[];
  transitional: SequenceExecutionStatus;
  terminal: SequenceExecutionStatus;
  acceptedEventType: MotorEventType;
  terminalEventType: MotorEventType;
}

/**
 * Fase "Control operativo de Gestiones" — RUNNING -> PAUSE_REQUESTED ->
 * PAUSED; PAUSED -> RESUME_REQUESTED -> RUNNING; {RUNNING,PAUSED} ->
 * STOP_REQUESTED -> STOPPED. Every other current status (including every
 * *_REQUESTED transitional value for a DIFFERENT action, DRAFT, and every
 * terminal value) is rejected with 409 — this table is the single source
 * of truth other than the equally-authoritative
 * `conditionalUpdateStatusFromAllowed` claim in the DB itself.
 */
const CONTROL_TRANSITIONS: Record<ControlAction, ControlTransition> = {
  PAUSE: {
    allowedFrom: ['RUNNING'],
    transitional: 'PAUSE_REQUESTED',
    terminal: 'PAUSED',
    acceptedEventType: 'EXECUTION_PAUSE_ACCEPTED',
    terminalEventType: 'EXECUTION_PAUSED',
  },
  RESUME: {
    allowedFrom: ['PAUSED'],
    transitional: 'RESUME_REQUESTED',
    terminal: 'RUNNING',
    acceptedEventType: 'EXECUTION_RESUME_ACCEPTED',
    terminalEventType: 'EXECUTION_RESUMED',
  },
  STOP: {
    allowedFrom: ['RUNNING', 'PAUSED'],
    transitional: 'STOP_REQUESTED',
    terminal: 'STOPPED',
    acceptedEventType: 'EXECUTION_STOP_ACCEPTED',
    terminalEventType: 'EXECUTION_STOPPED',
  },
};

const VERB_PAST: Record<ControlAction, string> = { PAUSE: 'paused', RESUME: 'resumed', STOP: 'stopped' };
const VERB_ES: Record<ControlAction, string> = { PAUSE: 'pausar', RESUME: 'reanudar', STOP: 'detener' };

/**
 * Admin-only pause/resume/stop of a Gestión — ADMIN never calls
 * StartSequenceExecutionUseCase's motor method directly; this is its own
 * use case because the transition table, the motor calls
 * (pauseExecution/resumeExecution/stopExecution — never startExecution),
 * and the audit vocabulary are all genuinely different, even though the
 * shape (ETAPA A claim -> motor call outside any transaction -> ETAPA C
 * persist result) is deliberately the same template as
 * StartSequenceExecutionUseCase.
 */
@Injectable()
export class ControlSequenceExecutionUseCase {
  constructor(
    @Inject(SEQUENCE_EXECUTION_REPOSITORY) private readonly executions: SequenceExecutionRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    @Inject(SEQUENCE_EXECUTION_MOTOR_PORT) private readonly motor: SequenceExecutionMotorPort,
    @Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManager,
    @Inject(INTEGRATION_COMMAND_REPOSITORY) private readonly commands: IntegrationCommandRepository,
    private readonly executionsService: SequenceExecutionsService,
    private readonly processEvent: ProcessMotorEventUseCase,
  ) {}

  async execute(input: ControlSequenceExecutionInput): Promise<SequenceExecutionSummary> {
    const config = CONTROL_TRANSITIONS[input.action];
    const execution = await this.requireExecutionRow(input.organizationId, input.executionId);

    let reason: string | null = null;
    if (input.action === 'STOP') {
      reason = (input.reason ?? '').trim();
      if (reason.length < 3 || reason.length > 300) {
        throw new BadRequestException('El motivo debe tener entre 3 y 300 caracteres.');
      }
    }

    // Idempotent no-op — ONLY for a verified retry of the exact same
    // command (matching lastControlIdempotencyKey): never call the motor
    // again, never duplicate the audit trail. This check is intentionally
    // narrower than "status already equals the terminal value", because
    // RESUME's terminal value (RUNNING) is not exclusive to resume — a
    // freshly-started Gestión reaches RUNNING without ever being paused,
    // so a bare status match would wrongly treat "resume an execution
    // that was never paused" as an idempotent success instead of the 409
    // the transition table requires (RESUME.allowedFrom is only PAUSED).
    // PAUSED/STOPPED are exclusively reachable via their own control
    // action, so this narrower check changes nothing for those — it only
    // closes the RESUME gap.
    if (execution.status === config.terminal && execution.lastControlIdempotencyKey === input.idempotencyKey) {
      return this.executionsService.getAny(input.organizationId, execution.id);
    }

    const isRetry = execution.status === config.transitional;
    if (!isRetry && !config.allowedFrom.includes(execution.status)) {
      throw new ConflictException(
        `No es posible ${VERB_ES[input.action]} esta gestión desde su estado actual (${execution.status}).`,
      );
    }

    // Only meaningful if the motor definitively rejects the command — see
    // the class-level note on this being a disclosed simplification for
    // STOP specifically (allowedFrom has two members there), since once a
    // retry is in flight the original pre-transitional status is no
    // longer recoverable from the row alone.
    const revertStatus: SequenceExecutionStatus = !isRetry
      ? (execution.status as SequenceExecutionStatus)
      : config.allowedFrom.length === 1
        ? config.allowedFrom[0]
        : 'RUNNING';

    const idempotencyKey =
      isRetry && execution.lastControlIdempotencyKey ? execution.lastControlIdempotencyKey : input.idempotencyKey;
    const correlationId = input.correlationId ?? execution.id;
    const commandType = `SEQUENCE_EXECUTION_${input.action}_REQUESTED` as CommandType;
    const commandStorageKey = buildIdempotencyStorageKey(
      `sequence_execution.control.${input.action.toLowerCase()}`,
      idempotencyKey,
    );

    // ETAPA A — claims the transitional status and creates (or, on a
    // retry, locates) the IntegrationCommand REQUESTED row, all or
    // nothing. The motor has not been called yet.
    const { rowId: commandRowId, commandId } = await this.tx.run(async (ctx) => {
      if (!isRetry) {
        const claimed = await this.executions.conditionalUpdateStatusFromAllowed(
          execution.id,
          config.allowedFrom,
          config.transitional,
          ctx,
        );
        if (claimed === 0) {
          throw new ConflictException(
            `No es posible ${VERB_ES[input.action]} esta gestión desde su estado actual (${execution.status}).`,
          );
        }
      }
      await this.executions.update(
        execution.id,
        { lastControlIdempotencyKey: idempotencyKey, ...(reason !== null ? { stopReason: reason } : {}) },
        ctx,
      );
      await this.auditLogs.record(
        {
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: `sequence_execution.${input.action.toLowerCase()}_requested`,
          entityType: 'SequenceExecution',
          entityId: execution.id,
          metadata: { previousStatus: execution.status, correlationId, ...(reason !== null ? { reason } : {}) },
        },
        ctx,
      );

      const existingCommand = await this.commands.findByIdempotencyKey(input.organizationId, commandStorageKey, ctx);
      if (existingCommand) return { rowId: existingCommand.id, commandId: existingCommand.commandId };
      const created = await this.commands.create(
        {
          organizationId: input.organizationId,
          commandId: `cmd_${randomUUID()}`,
          commandType,
          aggregateType: 'EXECUTION',
          aggregateId: execution.id,
          schemaVersion: '1.0',
          idempotencyKey: commandStorageKey,
          correlationId,
          payload: { action: input.action, ...(reason !== null ? { reason } : {}) },
          requestedBy: input.actorId,
        },
        ctx,
      );
      return { rowId: created.id, commandId: created.commandId };
    });

    try {
      const motorInput = {
        idempotencyKey,
        correlationId,
        localExecutionId: execution.id,
        serverExecutionId: execution.serverExecutionId ?? '',
        ...(reason !== null ? { reason } : {}),
      };
      let result: ExecutionControlCommandResult;
      if (input.action === 'PAUSE') result = await this.motor.pauseExecution(motorInput);
      else if (input.action === 'RESUME') result = await this.motor.resumeExecution(motorInput);
      else result = await this.motor.stopExecution(motorInput);

      if (result.accepted) {
        // ETAPA C — persists the motor's (synchronous) response: entity +
        // IntegrationCommand + audit, all or nothing. The status write is
        // itself an atomic transitional->terminal claim (never a plain
        // update) so two concurrent callers that both raced through the
        // motor call with the same idempotencyKey (double click) can
        // never both win — only the first to claim it here writes the
        // audit entry and emits the confirmation events.
        const wonTerminalClaim = await this.tx.run(async (ctx) => {
          const claimed = await this.executions.conditionalUpdateStatusFromAllowed(
            execution.id,
            [config.transitional],
            config.terminal,
            ctx,
          );
          if (claimed === 0) return false;
          await this.executions.update(
            execution.id,
            {
              lastSyncedAt: new Date(),
              ...(input.action === 'PAUSE' ? { pausedAt: new Date() } : {}),
              ...(input.action === 'RESUME' ? { resumedAt: new Date() } : {}),
              ...(input.action === 'STOP' ? { stoppedAt: new Date() } : {}),
            },
            ctx,
          );
          await this.commands.update(commandRowId, { status: 'COMPLETED', completedAt: new Date() }, ctx);
          await this.auditLogs.record(
            {
              organizationId: input.organizationId,
              actorId: input.actorId,
              action: `sequence_execution.${VERB_PAST[input.action]}`,
              entityType: 'SequenceExecution',
              entityId: execution.id,
              metadata: {
                previousStatus: execution.status,
                newStatus: config.terminal,
                correlationId,
                commandId,
                ...(reason !== null ? { reason } : {}),
              },
            },
            ctx,
          );
          return true;
        });

        if (wonTerminalClaim) {
          // Post-commit, best-effort: run the same real event pipeline a
          // genuinely asynchronous motor's webhook would use, so the
          // ACCEPTED + terminal phases are persisted IntegrationEvent
          // rows, visible in Monitor de integración, and re-projectable —
          // never a shortcut that skips MotorEventProjector. A failure
          // here never undoes the already-committed status transition.
          await this.emitControlEvents(input.organizationId, execution.id, commandId, correlationId, config, reason);
        }

        return this.executionsService.getAny(input.organizationId, execution.id);
      }

      await this.tx.run(async (ctx) => {
        await this.executions.update(execution.id, { status: revertStatus, lastError: result.rejectionReason }, ctx);
        await this.commands.update(
          commandRowId,
          { status: 'FAILED', completedAt: new Date(), lastError: result.rejectionReason },
          ctx,
        );
        await this.auditLogs.record(
          {
            organizationId: input.organizationId,
            actorId: input.actorId,
            action: `sequence_execution.${input.action.toLowerCase()}_rejected`,
            entityType: 'SequenceExecution',
            entityId: execution.id,
            metadata: { error: result.rejectionReason, correlationId },
          },
          ctx,
        );
      });
      throw new ConflictException(result.rejectionReason ?? 'El motor rechazó el comando.');
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      // Transport failure — the motor could not be reached. Mr Outreach
      // does not know whether the command was received, so it leaves the
      // execution at its *_REQUESTED transitional status (never silently
      // reverted) so a retry with the same idempotencyKey is possible and
      // safe, mirroring StartSequenceExecutionUseCase's SUBMISSION_UNKNOWN
      // handling.
      await this.auditLogs
        .record({
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: `sequence_execution.${input.action.toLowerCase()}_failed`,
          entityType: 'SequenceExecution',
          entityId: execution.id,
          metadata: {
            error: error instanceof Error ? error.message : 'Error desconocido.',
            transport: error instanceof ServiceUnavailableException,
            correlationId,
          },
        })
        .catch(() => undefined);
      throw error;
    }
  }

  private async requireExecutionRow(organizationId: string, executionId: string): Promise<SequenceExecution> {
    const execution = await this.executions.findById(executionId);
    if (!execution || execution.organizationId !== organizationId) {
      throw new NotFoundException('Gestión no encontrada.');
    }
    return execution;
  }

  private async emitControlEvents(
    organizationId: string,
    executionId: string,
    commandId: string | null,
    correlationId: string,
    config: ControlTransition,
    reason: string | null,
  ): Promise<void> {
    try {
      await this.processEvent.execute({
        envelope: this.buildEnvelope(organizationId, executionId, commandId, correlationId, config.acceptedEventType, {}),
        origin: 'SIMULATED',
      });
      await this.processEvent.execute({
        envelope: this.buildEnvelope(
          organizationId,
          executionId,
          commandId,
          correlationId,
          config.terminalEventType,
          config.terminalEventType === 'EXECUTION_STOPPED' ? { reason: reason ?? '' } : {},
        ),
        origin: 'SIMULATED',
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'control_sequence_execution.event_emission_failed',
          executionId,
          organizationId,
          message: error instanceof Error ? error.message : 'unknown error',
        }),
      );
    }
  }

  private buildEnvelope(
    organizationId: string,
    executionId: string,
    commandId: string | null,
    correlationId: string,
    eventType: MotorEventType,
    payload: Record<string, unknown>,
  ): MotorEventEnvelopeDto {
    return Object.assign(new MotorEventEnvelopeDto(), {
      schemaVersion: MOTOR_EVENT_SCHEMA_VERSION,
      eventId: `evt_${randomUUID()}`,
      eventType,
      occurredAt: new Date().toISOString(),
      organizationId,
      commandId,
      correlationId,
      aggregateType: 'EXECUTION' as const,
      aggregateId: executionId,
      payload,
    });
  }
}
