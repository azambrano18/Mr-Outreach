import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CreateSequenceContactInput,
  SequenceContact,
  UpdateSequenceContactInput,
} from '../../../domain/sequence-contact/sequence-contact.entity';
import {
  SequenceContactFilter,
  SequenceContactRepository,
} from '../../../domain/sequence-contact/sequence-contact.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemorySequenceContactRepository implements SequenceContactRepository {
  constructor(private readonly store: MemoryStore) {}

  async findById(id: string): Promise<SequenceContact | null> {
    return this.store.sequenceContacts.get(id) ?? null;
  }

  async findBySequence(
    organizationId: string,
    sequenceId: string,
    filter: SequenceContactFilter = {},
  ): Promise<SequenceContact[]> {
    let results = Array.from(this.store.sequenceContacts.values()).filter(
      (row) => row.organizationId === organizationId && row.sequenceId === sequenceId,
    );
    if (filter.companyId) {
      results = results.filter((row) => row.companyId === filter.companyId);
    }
    if (filter.status) {
      results = results.filter((row) => row.status === filter.status);
    }
    return results;
  }

  async findByContactAndSequence(
    sequenceId: string,
    contactId: string,
  ): Promise<SequenceContact | null> {
    for (const row of this.store.sequenceContacts.values()) {
      if (row.sequenceId === sequenceId && row.contactId === contactId) {
        return row;
      }
    }
    return null;
  }

  async findByContact(organizationId: string, contactId: string): Promise<SequenceContact[]> {
    return Array.from(this.store.sequenceContacts.values()).filter(
      (row) => row.organizationId === organizationId && row.contactId === contactId,
    );
  }

  async findAllByOrganization(organizationId: string): Promise<SequenceContact[]> {
    return Array.from(this.store.sequenceContacts.values()).filter(
      (row) => row.organizationId === organizationId,
    );
  }

  async create(input: CreateSequenceContactInput): Promise<SequenceContact> {
    const existing = await this.findByContactAndSequence(input.sequenceId, input.contactId);
    if (existing) {
      throw new ConflictException('This contact is already enrolled in this sequence.');
    }

    const now = new Date();
    const row: SequenceContact = {
      id: randomUUID(),
      organizationId: input.organizationId,
      clientId: input.clientId,
      sequenceId: input.sequenceId,
      sequenceVersion: input.sequenceVersion,
      contactId: input.contactId,
      companyId: input.companyId,
      sourceImportId: input.sourceImportId ?? null,
      assignedMailboxId: input.assignedMailboxId,
      assignedExecutiveId: input.assignedExecutiveId,
      currentStepId: input.currentStepId,
      currentStepPosition: input.currentStepPosition,
      status: 'ACTIVE',
      nextScheduledAt: null,
      startedAt: now,
      lastSentAt: null,
      repliedAt: null,
      completedAt: null,
      stoppedAt: null,
      stopReason: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.sequenceContacts.set(row.id, row);
    return row;
  }

  async update(id: string, input: UpdateSequenceContactInput): Promise<SequenceContact> {
    const existing = this.store.sequenceContacts.get(id);
    if (!existing) {
      throw new NotFoundException('Sequence contact not found.');
    }
    const updated: SequenceContact = { ...existing, ...input, updatedAt: new Date() };
    this.store.sequenceContacts.set(id, updated);
    return updated;
  }
}
