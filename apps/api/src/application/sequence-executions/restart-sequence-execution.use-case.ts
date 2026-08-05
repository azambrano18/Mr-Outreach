import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { ConversationRepository } from '../../domain/conversation/conversation.repository';
import { IntegrationCommandRepository } from '../../domain/integration/integration-command.repository';
import { TransactionManager } from '../../domain/persistence/transaction';
import { ProspectImportRepository } from '../../domain/prospect-import/prospect-import.repository';
import { ProspectImportRow } from '../../domain/prospect-import/prospect-import-row.entity';
import { ProspectImportRowRepository } from '../../domain/prospect-import/prospect-import-row.repository';
import { SequenceExecution } from '../../domain/sequence-execution/sequence-execution.entity';
import { SequenceExecutionRepository } from '../../domain/sequence-execution/sequence-execution.repository';
import {
  AUDIT_LOG_REPOSITORY,
  CONVERSATION_REPOSITORY,
  INTEGRATION_COMMAND_REPOSITORY,
  PROSPECT_IMPORT_REPOSITORY,
  PROSPECT_IMPORT_ROW_REPOSITORY,
  SEQUENCE_EXECUTION_REPOSITORY,
  TRANSACTION_MANAGER,
} from '../../infrastructure/persistence/tokens';
import { buildIdempotencyStorageKey } from '../idempotency/idempotent-operation.service';
import { SequenceExecutionsService } from './sequence-executions.service';
import { SequenceExecutionSummary } from './sequence-executions.types';

export interface RestartEligibility {
  executionId: string;
  managementName: string | null;
  mailboxEmail: string;
  templateName: string;
  templateVersionNumber: number;
  /** Every VALID row from the previous attempt's prospect import. */
  totalContacts: number;
  /** VALID rows that already have a Conversation for this execution — i.e. received at least one email (Envío 1/2/3). */
  alreadyContactedCount: number;
  /** VALID rows with no Conversation at all for this execution — never emailed, safe to include in the new attempt. */
  eligibleCount: number;
}

export interface RestartSequenceExecutionInput {
  organizationId: string;
  actorId: string;
  executionId: string;
  idempotencyKey: string;
  correlationId?: string;
  reason?: string;
}

const BLOCKED_RESTART_MESSAGE = 'No existen contactos pendientes que puedan reiniciarse sin duplicar envíos.';

/**
 * Fase "Reiniciar Gestión" — never rewrites the STOPPED execution: it
 * creates a brand-new SequenceExecution (attempt N+1, `previousExecutionId`
 * pointing at the STOPPED one) with its own new ProspectImport, containing
 * only contacts that never received any email in the previous attempt
 * (Envío 1/2/3 all excluded). The new attempt lands in DRAFT — actually
 * dispatching it reuses the existing StartSequenceExecutionUseCase
 * unmodified, exactly like any other freshly-drafted Gestión; this class
 * never calls the motor at all (SEQUENCE_EXECUTION_RESTART_REQUESTED is a
 * purely local idempotency/audit record, same shape as
 * MAILBOX_REASSIGN_PRIMARY_REQUESTED).
 */
@Injectable()
export class RestartSequenceExecutionUseCase {
  constructor(
    @Inject(SEQUENCE_EXECUTION_REPOSITORY) private readonly executions: SequenceExecutionRepository,
    @Inject(PROSPECT_IMPORT_REPOSITORY) private readonly prospectImports: ProspectImportRepository,
    @Inject(PROSPECT_IMPORT_ROW_REPOSITORY) private readonly prospectRows: ProspectImportRowRepository,
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    @Inject(INTEGRATION_COMMAND_REPOSITORY) private readonly commands: IntegrationCommandRepository,
    @Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManager,
    private readonly executionsService: SequenceExecutionsService,
  ) {}

  /** Read-only — safe to call regardless of the execution's current status, purely to populate the confirmation modal. */
  async preview(organizationId: string, executionId: string): Promise<RestartEligibility> {
    const summary = await this.executionsService.getAny(organizationId, executionId);
    const execution = await this.requireExecutionRow(organizationId, executionId);
    const { validRows, eligibleRows } = await this.computeEligibleRows(organizationId, execution);
    return {
      executionId,
      managementName: summary.name,
      mailboxEmail: summary.mailboxEmail,
      templateName: summary.templateName,
      templateVersionNumber: summary.templateVersionNumber,
      totalContacts: validRows.length,
      alreadyContactedCount: validRows.length - eligibleRows.length,
      eligibleCount: eligibleRows.length,
    };
  }

  async execute(input: RestartSequenceExecutionInput): Promise<SequenceExecutionSummary> {
    const execution = await this.requireExecutionRow(input.organizationId, input.executionId);
    if (execution.status !== 'STOPPED') {
      throw new ConflictException('Solo se pueden reiniciar gestiones detenidas.');
    }

    const correlationId = input.correlationId ?? execution.id;
    const commandStorageKey = buildIdempotencyStorageKey('sequence_execution.control.restart', input.idempotencyKey);

    // Idempotent: a double-click (same idempotencyKey) never creates a
    // second new execution — it returns the exact one the first call
    // already created.
    const existingCommand = await this.commands.findByIdempotencyKey(input.organizationId, commandStorageKey);
    if (existingCommand) {
      const newExecutionId = (existingCommand.resultSnapshot as Record<string, unknown> | null)?.newExecutionId;
      if (typeof newExecutionId === 'string') {
        return this.executionsService.getAny(input.organizationId, newExecutionId);
      }
    }

    const { validRows, eligibleRows } = await this.computeEligibleRows(input.organizationId, execution);
    if (eligibleRows.length === 0) {
      throw new ConflictException(BLOCKED_RESTART_MESSAGE);
    }

    const oldImport = await this.prospectImports.findByExecution(execution.id);

    const { newExecutionId } = await this.tx.run(async (ctx) => {
      const newExecution = await this.executions.create({
        organizationId: input.organizationId,
        executiveId: execution.executiveId,
        mailboxId: execution.mailboxId,
        templateId: execution.templateId,
        templateVersionId: execution.templateVersionId,
        timezone: execution.timezone,
        createdBy: input.actorId,
        executionAttempt: execution.executionAttempt + 1,
        previousExecutionId: execution.id,
      });

      const newImport = await this.prospectImports.create({
        organizationId: input.organizationId,
        executionId: newExecution.id,
        fileName: `reinicio_${execution.name ?? execution.id}.csv`,
        storageKey: `restart/${execution.id}/${randomUUID()}`,
        checksum: `restart-${randomUUID()}`,
        createdBy: input.actorId,
      });
      await this.prospectImports.update(newImport.id, {
        status: 'READY',
        columnMapping: oldImport?.columnMapping ?? null,
        totalRows: eligibleRows.length,
        validRows: eligibleRows.length,
        invalidRows: 0,
        duplicateRows: 0,
        excludedRows: validRows.length - eligibleRows.length,
      });

      await this.prospectRows.createMany(
        eligibleRows.map((row, index) => ({
          organizationId: input.organizationId,
          importId: newImport.id,
          rowNumber: index + 1,
          rawData: row.rawData,
          normalizedData: row.normalizedData,
          validationStatus: 'VALID' as const,
        })),
      );

      const commandId = `cmd_${randomUUID()}`;
      const createdCommand = await this.commands.create(
        {
          organizationId: input.organizationId,
          commandId,
          commandType: 'SEQUENCE_EXECUTION_RESTART_REQUESTED',
          aggregateType: 'EXECUTION',
          aggregateId: execution.id,
          schemaVersion: '1.0',
          idempotencyKey: commandStorageKey,
          correlationId,
          payload: { newExecutionId: newExecution.id, eligibleCount: eligibleRows.length, reason: input.reason ?? null },
          requestedBy: input.actorId,
        },
        ctx,
      );
      // Local-only command (no motor call ever made for a restart — see
      // class doc comment) goes straight REQUESTED -> COMPLETED, same as
      // MAILBOX_REASSIGN_PRIMARY_REQUESTED.
      await this.commands.update(
        createdCommand.id,
        { status: 'COMPLETED', completedAt: new Date(), resultSnapshot: { newExecutionId: newExecution.id } },
        ctx,
      );

      await this.auditLogs.record(
        {
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: 'sequence_execution.restarted',
          entityType: 'SequenceExecution',
          entityId: execution.id,
          metadata: {
            newExecutionId: newExecution.id,
            executionAttempt: newExecution.executionAttempt,
            eligibleCount: eligibleRows.length,
            alreadyContactedCount: validRows.length - eligibleRows.length,
            commandId,
            correlationId,
            reason: input.reason ?? null,
          },
        },
        ctx,
      );

      return { newExecutionId: newExecution.id };
    });

    return this.executionsService.getAny(input.organizationId, newExecutionId);
  }

  private async requireExecutionRow(organizationId: string, executionId: string): Promise<SequenceExecution> {
    const execution = await this.executions.findById(executionId);
    if (!execution || execution.organizationId !== organizationId) {
      throw new NotFoundException('Gestión no encontrada.');
    }
    return execution;
  }

  /**
   * §"reinicio excluye contactos que ya recibieron correos" — a VALID row
   * counts as "already contacted" if any Conversation for this execution
   * carries its prospectImportRowId; MotorEventProjector's
   * projectOutboundMessageCreated only ever creates such a Conversation
   * once at least one outbound email actually went out for that row, so
   * "a matching Conversation exists" is exactly equivalent to "received
   * Envío 1 (or later)" — no separate per-row send counter needed.
   */
  private async computeEligibleRows(
    organizationId: string,
    execution: SequenceExecution,
  ): Promise<{ validRows: ProspectImportRow[]; eligibleRows: ProspectImportRow[] }> {
    const oldImport = await this.prospectImports.findByExecution(execution.id);
    const allRows = oldImport ? await this.prospectRows.findByImport(oldImport.id) : [];
    const validRows = allRows.filter((row) => row.validationStatus === 'VALID');

    const conversationsForExecution = await this.conversations.findAll(organizationId, {
      sequenceExecutionId: execution.id,
    });
    const contactedRowIds = new Set(
      conversationsForExecution.map((c) => c.prospectImportRowId).filter((id): id is string => Boolean(id)),
    );
    const eligibleRows = validRows.filter((row) => !contactedRowIds.has(row.id));
    return { validRows, eligibleRows };
  }
}
