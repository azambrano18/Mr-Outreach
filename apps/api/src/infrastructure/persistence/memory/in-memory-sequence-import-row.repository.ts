import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CreateSequenceImportRowInput,
  SequenceImportRow,
  UpdateSequenceImportRowInput,
} from '../../../domain/sequence-import-row/sequence-import-row.entity';
import {
  BulkRowResult,
  SequenceImportRowFilter,
  SequenceImportRowRepository,
} from '../../../domain/sequence-import-row/sequence-import-row.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemorySequenceImportRowRepository implements SequenceImportRowRepository {
  constructor(private readonly store: MemoryStore) {}

  async findById(id: string): Promise<SequenceImportRow | null> {
    return this.store.sequenceImportRows.get(id) ?? null;
  }

  async findByImport(
    organizationId: string,
    importId: string,
    filter: SequenceImportRowFilter = {},
  ): Promise<SequenceImportRow[]> {
    let results = Array.from(this.store.sequenceImportRows.values()).filter(
      (row) => row.organizationId === organizationId && row.importId === importId,
    );
    if (filter.validationStatus) {
      results = results.filter((row) => row.validationStatus === filter.validationStatus);
    }
    return results.sort((a, b) => a.rowNumber - b.rowNumber);
  }

  async replaceForImport(
    organizationId: string,
    importId: string,
    rows: CreateSequenceImportRowInput[],
  ): Promise<SequenceImportRow[]> {
    for (const [id, row] of this.store.sequenceImportRows.entries()) {
      if (row.organizationId === organizationId && row.importId === importId) {
        this.store.sequenceImportRows.delete(id);
      }
    }
    const now = new Date();
    const created: SequenceImportRow[] = rows.map((input) => ({
      id: randomUUID(),
      organizationId: input.organizationId,
      importId: input.importId,
      rowNumber: input.rowNumber,
      rawData: input.rawData,
      normalizedData: input.normalizedData ?? null,
      companyRawName: input.companyRawName ?? null,
      email: input.email ?? null,
      validationStatus: input.validationStatus,
      validationErrors: input.validationErrors ?? [],
      isDuplicate: input.isDuplicate ?? false,
      rejectionReason: input.rejectionReason ?? null,
      contactId: null,
      createdAt: now,
      updatedAt: now,
    }));
    for (const row of created) {
      this.store.sequenceImportRows.set(row.id, row);
    }
    return created;
  }

  async update(id: string, input: UpdateSequenceImportRowInput): Promise<SequenceImportRow> {
    const existing = this.store.sequenceImportRows.get(id);
    if (!existing) {
      throw new NotFoundException('Sequence import row not found.');
    }
    const updated: SequenceImportRow = { ...existing, ...input, updatedAt: new Date() };
    this.store.sequenceImportRows.set(id, updated);
    return updated;
  }

  async bulkSetContactAndNormalizedData(updates: BulkRowResult[]): Promise<void> {
    for (const u of updates) {
      const existing = this.store.sequenceImportRows.get(u.rowId);
      if (!existing) continue;
      this.store.sequenceImportRows.set(u.rowId, {
        ...existing,
        contactId: u.contactId,
        normalizedData: u.normalizedData,
        updatedAt: new Date(),
      });
    }
  }
}
