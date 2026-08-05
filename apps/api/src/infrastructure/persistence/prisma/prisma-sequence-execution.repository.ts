import { Injectable } from '@nestjs/common';
import { SequenceExecution as PrismaExecutionRow } from '@prisma/client';
import { TransactionContext } from '../../../domain/persistence/transaction';
import { ProspectExecutionState } from '../../../domain/prospect-import/prospect-import-row.entity';
import {
  CreateSequenceExecutionInput,
  SequenceExecution,
  SequenceExecutionServerStatus,
  SequenceExecutionStatus,
  UpdateSequenceExecutionInput,
} from '../../../domain/sequence-execution/sequence-execution.entity';
import { SequenceExecutionRepository } from '../../../domain/sequence-execution/sequence-execution.repository';
import { PrismaService } from './prisma.service';
import { resolveClient } from './prisma-transaction-manager';

function toDomain(row: PrismaExecutionRow): SequenceExecution {
  return {
    id: row.id,
    organizationId: row.organizationId,
    executiveId: row.executiveId,
    mailboxId: row.mailboxId,
    templateId: row.templateId,
    templateVersionId: row.templateVersionId,
    name: row.name,
    timezone: row.timezone,
    status: row.status as SequenceExecutionStatus,
    prospectImportId: row.prospectImportId,
    requestedAt: row.requestedAt,
    receivedAt: row.receivedAt,
    estimatedStartAt: row.estimatedStartAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    failedAt: row.failedAt,
    serverStatus: row.serverStatus as SequenceExecutionServerStatus | null,
    currentStepNumber: row.currentStepNumber,
    sentCount: row.sentCount,
    pendingCount: row.pendingCount,
    failedCount: row.failedCount,
    receivedProspects: row.receivedProspects,
    acceptedProspects: row.acceptedProspects,
    rejectedProspects: row.rejectedProspects,
    initialProspectState: row.initialProspectState as ProspectExecutionState | null,
    lastSyncedAt: row.lastSyncedAt,
    lastError: row.lastError,
    serverExecutionId: row.serverExecutionId,
    executionTokenCiphertext: row.executionTokenCiphertext,
    lastSubmissionIdempotencyKey: row.lastSubmissionIdempotencyKey,
    pausedAt: row.pausedAt,
    resumedAt: row.resumedAt,
    stoppedAt: row.stoppedAt,
    stopReason: row.stopReason,
    lastControlIdempotencyKey: row.lastControlIdempotencyKey,
    executionAttempt: row.executionAttempt,
    previousExecutionId: row.previousExecutionId,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PrismaSequenceExecutionRepository implements SequenceExecutionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string, ctx?: TransactionContext): Promise<SequenceExecution | null> {
    const client = resolveClient(this.prisma, ctx);
    const row = await client.sequenceExecution.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByServerExecutionId(serverExecutionId: string, ctx?: TransactionContext): Promise<SequenceExecution | null> {
    const row = await resolveClient(this.prisma, ctx).sequenceExecution.findUnique({ where: { serverExecutionId } });
    return row ? toDomain(row) : null;
  }

  async findByExecutive(organizationId: string, executiveId: string): Promise<SequenceExecution[]> {
    const rows = await this.prisma.sequenceExecution.findMany({ where: { organizationId, executiveId } });
    return rows.map(toDomain);
  }

  async findAllByOrganization(organizationId: string): Promise<SequenceExecution[]> {
    const rows = await this.prisma.sequenceExecution.findMany({ where: { organizationId } });
    return rows.map(toDomain);
  }

  async create(input: CreateSequenceExecutionInput): Promise<SequenceExecution> {
    const row = await this.prisma.sequenceExecution.create({
      data: {
        organizationId: input.organizationId,
        executiveId: input.executiveId,
        mailboxId: input.mailboxId,
        templateId: input.templateId,
        templateVersionId: input.templateVersionId,
        timezone: input.timezone,
        createdBy: input.createdBy,
        ...(input.executionAttempt !== undefined && { executionAttempt: input.executionAttempt }),
        ...(input.previousExecutionId !== undefined && { previousExecutionId: input.previousExecutionId }),
      },
    });
    return toDomain(row);
  }

  async update(id: string, input: UpdateSequenceExecutionInput, ctx?: TransactionContext): Promise<SequenceExecution> {
    const client = resolveClient(this.prisma, ctx);
    const row = await client.sequenceExecution.update({
      where: { id },
      data: {
        status: input.status,
        mailboxId: input.mailboxId,
        templateId: input.templateId,
        templateVersionId: input.templateVersionId,
        name: input.name,
        timezone: input.timezone,
        prospectImportId: input.prospectImportId,
        requestedAt: input.requestedAt,
        receivedAt: input.receivedAt,
        estimatedStartAt: input.estimatedStartAt,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        failedAt: input.failedAt,
        serverStatus: input.serverStatus,
        currentStepNumber: input.currentStepNumber,
        sentCount: input.sentCount,
        pendingCount: input.pendingCount,
        failedCount: input.failedCount,
        receivedProspects: input.receivedProspects,
        acceptedProspects: input.acceptedProspects,
        rejectedProspects: input.rejectedProspects,
        initialProspectState: input.initialProspectState,
        lastSyncedAt: input.lastSyncedAt,
        lastError: input.lastError,
        serverExecutionId: input.serverExecutionId,
        executionTokenCiphertext: input.executionTokenCiphertext,
        lastSubmissionIdempotencyKey: input.lastSubmissionIdempotencyKey,
        pausedAt: input.pausedAt,
        resumedAt: input.resumedAt,
        stoppedAt: input.stoppedAt,
        stopReason: input.stopReason,
        lastControlIdempotencyKey: input.lastControlIdempotencyKey,
      },
    });
    return toDomain(row);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.sequenceExecution.delete({ where: { id } });
  }

  async conditionalUpdateStatus(
    id: string,
    blockedStatuses: SequenceExecutionStatus[],
    toStatus: SequenceExecutionStatus,
    ctx?: TransactionContext,
  ): Promise<number> {
    const client = resolveClient(this.prisma, ctx);
    const result = await client.sequenceExecution.updateMany({
      where: { id, status: { notIn: blockedStatuses } },
      data: { status: toStatus },
    });
    return result.count;
  }

  async conditionalUpdateStatusFromAllowed(
    id: string,
    allowedFromStatuses: SequenceExecutionStatus[],
    toStatus: SequenceExecutionStatus,
    ctx?: TransactionContext,
  ): Promise<number> {
    const client = resolveClient(this.prisma, ctx);
    const result = await client.sequenceExecution.updateMany({
      where: { id, status: { in: allowedFromStatuses } },
      data: { status: toStatus },
    });
    return result.count;
  }
}
