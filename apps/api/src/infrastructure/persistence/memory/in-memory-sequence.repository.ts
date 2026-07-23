import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CreateSequenceInput,
  Sequence,
  UpdateSequenceInput,
} from '../../../domain/sequence/sequence.entity';
import { SequenceRepository } from '../../../domain/sequence/sequence.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemorySequenceRepository implements SequenceRepository {
  constructor(private readonly store: MemoryStore) {}

  async findById(id: string): Promise<Sequence | null> {
    const sequence = this.store.sequences.get(id);
    return sequence && !sequence.deletedAt ? sequence : null;
  }

  async findByExecutive(organizationId: string, executiveId: string): Promise<Sequence[]> {
    return Array.from(this.store.sequences.values()).filter(
      (sequence) =>
        !sequence.deletedAt &&
        sequence.organizationId === organizationId &&
        sequence.executiveId === executiveId,
    );
  }

  async findByClient(organizationId: string, clientId: string): Promise<Sequence[]> {
    return Array.from(this.store.sequences.values()).filter(
      (sequence) =>
        !sequence.deletedAt &&
        sequence.organizationId === organizationId &&
        sequence.clientId === clientId,
    );
  }

  async findAllByOrganization(organizationId: string): Promise<Sequence[]> {
    return Array.from(this.store.sequences.values()).filter(
      (sequence) => !sequence.deletedAt && sequence.organizationId === organizationId,
    );
  }

  async create(input: CreateSequenceInput): Promise<Sequence> {
    const now = new Date();
    const sequence: Sequence = {
      id: randomUUID(),
      organizationId: input.organizationId,
      executiveId: input.executiveId,
      mailboxId: null,
      clientId: null,
      name: input.name,
      description: input.description ?? null,
      status: 'DRAFT',
      timezone: input.timezone,
      schedule: input.schedule ?? {
        days: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
        windows: [{ start: '09:00', end: '18:00' }],
      },
      policies: {
        stopOnReply: true,
        stopOnHardBounce: true,
        stopOnUnsubscribe: true,
        prioritizeFollowUps: true,
      },
      managementDate: input.managementDate ?? null,
      stepPolicy: input.stepPolicy ?? 'FLEXIBLE',
      publishStatus: null,
      effectiveStartAt: null,
      sequenceVersion: 0,
      lastPublishedAt: null,
      lastPublishCommandId: null,
      createdBy: input.createdBy,
      updatedBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.store.sequences.set(sequence.id, sequence);
    return sequence;
  }

  async update(id: string, input: UpdateSequenceInput): Promise<Sequence> {
    const existing = this.store.sequences.get(id);
    if (!existing) {
      throw new Error('Sequence not found.');
    }
    const updated: Sequence = {
      ...existing,
      ...input,
      policies: input.policies ? { ...existing.policies, ...input.policies } : existing.policies,
      updatedAt: new Date(),
    };
    this.store.sequences.set(id, updated);
    return updated;
  }
}
