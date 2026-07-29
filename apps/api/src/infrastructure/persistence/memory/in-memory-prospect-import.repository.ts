import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CreateProspectImportInput,
  ProspectImport,
  UpdateProspectImportInput,
} from '../../../domain/prospect-import/prospect-import.entity';
import { ProspectImportRepository } from '../../../domain/prospect-import/prospect-import.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemoryProspectImportRepository implements ProspectImportRepository {
  constructor(private readonly store: MemoryStore) {}

  async findById(id: string): Promise<ProspectImport | null> {
    return this.store.prospectImports.get(id) ?? null;
  }

  async findByExecution(executionId: string): Promise<ProspectImport | null> {
    return [...this.store.prospectImports.values()].find((i) => i.executionId === executionId) ?? null;
  }

  async create(input: CreateProspectImportInput): Promise<ProspectImport> {
    const now = new Date();
    const record: ProspectImport = {
      id: randomUUID(),
      organizationId: input.organizationId,
      executionId: input.executionId,
      fileName: input.fileName,
      storageKey: input.storageKey,
      checksum: input.checksum,
      status: 'UPLOADED',
      columnMapping: null,
      totalRows: 0,
      validRows: 0,
      invalidRows: 0,
      duplicateRows: 0,
      excludedRows: 0,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    this.store.prospectImports.set(record.id, record);
    return record;
  }

  async update(id: string, input: UpdateProspectImportInput): Promise<ProspectImport> {
    const existing = this.store.prospectImports.get(id);
    if (!existing) throw new Error(`ProspectImport ${id} not found`);
    const updated: ProspectImport = { ...existing, ...input, updatedAt: new Date() };
    this.store.prospectImports.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.store.prospectImports.delete(id);
  }
}
