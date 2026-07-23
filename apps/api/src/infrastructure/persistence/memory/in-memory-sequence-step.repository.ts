import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CreateSequenceStepInput,
  SequenceStep,
  UpdateSequenceStepInput,
} from '../../../domain/sequence/sequence-step.entity';
import { SequenceStepRepository } from '../../../domain/sequence/sequence-step.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemorySequenceStepRepository implements SequenceStepRepository {
  constructor(private readonly store: MemoryStore) {}

  async findById(id: string): Promise<SequenceStep | null> {
    const step = this.store.sequenceSteps.get(id);
    return step && !step.deletedAt ? step : null;
  }

  async findBySequence(sequenceId: string): Promise<SequenceStep[]> {
    return Array.from(this.store.sequenceSteps.values())
      .filter((step) => !step.deletedAt && step.sequenceId === sequenceId)
      .sort((a, b) => a.position - b.position);
  }

  async findAllByOrganization(organizationId: string): Promise<SequenceStep[]> {
    return Array.from(this.store.sequenceSteps.values()).filter(
      (step) => !step.deletedAt && step.organizationId === organizationId,
    );
  }

  async create(input: CreateSequenceStepInput): Promise<SequenceStep> {
    const now = new Date();
    const step: SequenceStep = {
      id: randomUUID(),
      organizationId: input.organizationId,
      sequenceId: input.sequenceId,
      position: input.position,
      name: input.name,
      subject: input.subject,
      preheader: input.preheader ?? null,
      htmlHeader: input.htmlHeader ?? null,
      htmlBody: input.htmlBody,
      plainTextBody: input.plainTextBody,
      delayValue: input.delayValue,
      delayUnit: input.delayUnit,
      sendMode: input.sendMode,
      status: 'DRAFT',
      createdBy: input.createdBy,
      updatedBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.store.sequenceSteps.set(step.id, step);
    return step;
  }

  async update(id: string, input: UpdateSequenceStepInput): Promise<SequenceStep> {
    const existing = this.store.sequenceSteps.get(id);
    if (!existing) {
      throw new Error('Sequence step not found.');
    }
    const updated: SequenceStep = { ...existing, ...input, updatedAt: new Date() };
    this.store.sequenceSteps.set(id, updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const existing = this.store.sequenceSteps.get(id);
    if (existing) {
      existing.deletedAt = new Date();
    }
  }
}
