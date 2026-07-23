import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CreateSequenceImportInput,
  SequenceImport,
  UpdateSequenceImportInput,
} from '../../../domain/sequence-import/sequence-import.entity';
import { SequenceImportRepository } from '../../../domain/sequence-import/sequence-import.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemorySequenceImportRepository implements SequenceImportRepository {
  constructor(private readonly store: MemoryStore) {}

  async findById(id: string): Promise<SequenceImport | null> {
    return this.store.sequenceImports.get(id) ?? null;
  }

  async findBySequence(organizationId: string, sequenceId: string): Promise<SequenceImport[]> {
    return Array.from(this.store.sequenceImports.values())
      .filter((row) => row.organizationId === organizationId && row.sequenceId === sequenceId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async create(input: CreateSequenceImportInput): Promise<SequenceImport> {
    const now = new Date();
    const row: SequenceImport = {
      id: randomUUID(),
      organizationId: input.organizationId,
      clientId: input.clientId,
      sequenceId: input.sequenceId,
      executiveId: input.executiveId,
      mailboxId: input.mailboxId,
      status: 'UPLOADED',
      fileName: input.fileName,
      storageKey: input.storageKey,
      checksum: input.checksum,
      columnMapping: null,
      scenario: null,
      totalRows: input.totalRows,
      validRows: 0,
      invalidRows: 0,
      duplicateRows: 0,
      excludedRows: 0,
      companiesDetected: 0,
      contactsAccepted: 0,
      contactsRejected: 0,
      rejections: [],
      commandId: null,
      lastError: null,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    this.store.sequenceImports.set(row.id, row);
    return row;
  }

  async update(id: string, input: UpdateSequenceImportInput): Promise<SequenceImport> {
    const existing = this.store.sequenceImports.get(id);
    if (!existing) {
      throw new NotFoundException('Sequence import not found.');
    }
    const updated: SequenceImport = { ...existing, ...input, updatedAt: new Date() };
    this.store.sequenceImports.set(id, updated);
    return updated;
  }
}
