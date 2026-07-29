import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CreateSequenceExecutionInput,
  SequenceExecution,
  SequenceExecutionStatus,
  UpdateSequenceExecutionInput,
} from '../../../domain/sequence-execution/sequence-execution.entity';
import { SequenceExecutionRepository } from '../../../domain/sequence-execution/sequence-execution.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemorySequenceExecutionRepository implements SequenceExecutionRepository {
  constructor(private readonly store: MemoryStore) {}

  async findById(id: string): Promise<SequenceExecution | null> {
    return this.store.sequenceExecutions.get(id) ?? null;
  }

  async findByExecutive(organizationId: string, executiveId: string): Promise<SequenceExecution[]> {
    return [...this.store.sequenceExecutions.values()].filter(
      (e) => e.organizationId === organizationId && e.executiveId === executiveId,
    );
  }

  async findAllByOrganization(organizationId: string): Promise<SequenceExecution[]> {
    return [...this.store.sequenceExecutions.values()].filter((e) => e.organizationId === organizationId);
  }

  async create(input: CreateSequenceExecutionInput): Promise<SequenceExecution> {
    const now = new Date();
    const execution: SequenceExecution = {
      id: randomUUID(),
      organizationId: input.organizationId,
      executiveId: input.executiveId,
      mailboxId: input.mailboxId,
      templateId: input.templateId,
      templateVersionId: input.templateVersionId,
      name: null,
      timezone: input.timezone,
      status: 'DRAFT',
      prospectImportId: null,
      requestedAt: null,
      receivedAt: null,
      estimatedStartAt: null,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      serverStatus: null,
      currentStepNumber: null,
      sentCount: null,
      pendingCount: null,
      failedCount: null,
      receivedProspects: null,
      acceptedProspects: null,
      rejectedProspects: null,
      initialProspectState: null,
      lastSyncedAt: null,
      lastError: null,
      serverExecutionId: null,
      executionTokenCiphertext: null,
      lastSubmissionIdempotencyKey: null,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    this.store.sequenceExecutions.set(execution.id, execution);
    return execution;
  }

  async update(id: string, input: UpdateSequenceExecutionInput): Promise<SequenceExecution> {
    const existing = this.store.sequenceExecutions.get(id);
    if (!existing) throw new Error(`SequenceExecution ${id} not found`);
    const updated: SequenceExecution = { ...existing, ...input, updatedAt: new Date() };
    this.store.sequenceExecutions.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.store.sequenceExecutions.delete(id);
  }

  async conditionalUpdateStatus(
    id: string,
    blockedStatuses: SequenceExecutionStatus[],
    toStatus: SequenceExecutionStatus,
  ): Promise<number> {
    const existing = this.store.sequenceExecutions.get(id);
    if (!existing) return 0;
    if (blockedStatuses.includes(existing.status)) return 0;
    this.store.sequenceExecutions.set(id, { ...existing, status: toStatus, updatedAt: new Date() });
    return 1;
  }
}
