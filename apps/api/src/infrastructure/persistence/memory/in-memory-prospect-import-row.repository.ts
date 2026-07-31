import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CreateProspectImportRowInput,
  ProspectExecutionState,
  ProspectImportRow,
} from '../../../domain/prospect-import/prospect-import-row.entity';
import { ProspectImportRowRepository } from '../../../domain/prospect-import/prospect-import-row.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemoryProspectImportRowRepository implements ProspectImportRowRepository {
  constructor(private readonly store: MemoryStore) {}

  async findById(id: string): Promise<ProspectImportRow | null> {
    return this.store.prospectImportRows.get(id) ?? null;
  }

  async findByImport(importId: string): Promise<ProspectImportRow[]> {
    return [...this.store.prospectImportRows.values()]
      .filter((row) => row.importId === importId)
      .sort((a, b) => a.rowNumber - b.rowNumber);
  }

  private buildRow(input: CreateProspectImportRowInput): ProspectImportRow {
    return {
      id: randomUUID(),
      organizationId: input.organizationId,
      importId: input.importId,
      rowNumber: input.rowNumber,
      rawData: input.rawData,
      normalizedData: input.normalizedData ?? null,
      validationStatus: input.validationStatus,
      validationErrors: input.validationErrors ?? [],
      executionState: null,
      companyId: null,
      contactId: null,
      resolvedAt: null,
      createdAt: new Date(),
    };
  }

  async createMany(inputs: CreateProspectImportRowInput[]): Promise<ProspectImportRow[]> {
    const rows = inputs.map((input) => this.buildRow(input));
    for (const row of rows) this.store.prospectImportRows.set(row.id, row);
    return rows;
  }

  async replaceForImport(importId: string, inputs: CreateProspectImportRowInput[]): Promise<ProspectImportRow[]> {
    await this.deleteByImport(importId);
    return this.createMany(inputs);
  }

  async deleteByImport(importId: string): Promise<void> {
    for (const [id, row] of this.store.prospectImportRows) {
      if (row.importId === importId) this.store.prospectImportRows.delete(id);
    }
  }

  async markValidRowsExecutionState(importId: string, state: ProspectExecutionState): Promise<void> {
    for (const [id, row] of this.store.prospectImportRows) {
      if (row.importId === importId && row.validationStatus === 'VALID') {
        this.store.prospectImportRows.set(id, { ...row, executionState: state });
      }
    }
  }

  async bulkSetResolvedIdentity(
    updates: Array<{ rowId: string; companyId: string | null; contactId: string }>,
    resolvedAt: Date,
  ): Promise<void> {
    // No transaction context needed — the in-memory store has no isolation boundaries to cross.
    const byId = new Map(updates.map((u) => [u.rowId, u]));
    for (const [id, row] of this.store.prospectImportRows) {
      const update = byId.get(id);
      if (update) {
        this.store.prospectImportRows.set(id, {
          ...row,
          companyId: update.companyId,
          contactId: update.contactId,
          resolvedAt,
        });
      }
    }
  }
}
