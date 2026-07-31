import { Injectable } from '@nestjs/common';
import { Prisma, ProspectImportRow as PrismaRowRow } from '@prisma/client';
import {
  CreateProspectImportRowInput,
  NormalizedProspectData,
  ProspectExecutionState,
  ProspectImportRow,
  ProspectImportRowValidationStatus,
} from '../../../domain/prospect-import/prospect-import-row.entity';
import { ProspectImportRowRepository } from '../../../domain/prospect-import/prospect-import-row.repository';
import { TransactionContext } from '../../../domain/persistence/transaction';
import { PrismaService } from './prisma.service';
import { resolveClient } from './prisma-transaction-manager';

function toDomain(row: PrismaRowRow): ProspectImportRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    importId: row.importId,
    rowNumber: row.rowNumber,
    rawData: row.rawData as unknown as Record<string, string>,
    normalizedData: row.normalizedData as unknown as NormalizedProspectData | null,
    validationStatus: row.validationStatus as ProspectImportRowValidationStatus,
    validationErrors: row.validationErrors as unknown as string[],
    executionState: row.executionState as ProspectExecutionState | null,
    companyId: row.companyId,
    contactId: row.contactId,
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class PrismaProspectImportRowRepository implements ProspectImportRowRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByImport(importId: string): Promise<ProspectImportRow[]> {
    const rows = await this.prisma.prospectImportRow.findMany({
      where: { importId },
      orderBy: { rowNumber: 'asc' },
    });
    return rows.map(toDomain);
  }

  async createMany(inputs: CreateProspectImportRowInput[]): Promise<ProspectImportRow[]> {
    if (inputs.length === 0) return [];
    await this.prisma.prospectImportRow.createMany({
      data: inputs.map((input) => ({
        organizationId: input.organizationId,
        importId: input.importId,
        rowNumber: input.rowNumber,
        rawData: input.rawData as unknown as Prisma.InputJsonValue,
        normalizedData: (input.normalizedData ?? undefined) as unknown as Prisma.InputJsonValue,
        validationStatus: input.validationStatus,
        validationErrors: (input.validationErrors ?? []) as unknown as Prisma.InputJsonValue,
      })),
    });
    return this.findByImport(inputs[0].importId);
  }

  async replaceForImport(importId: string, inputs: CreateProspectImportRowInput[]): Promise<ProspectImportRow[]> {
    await this.prisma.prospectImportRow.deleteMany({ where: { importId } });
    if (inputs.length === 0) return [];
    await this.prisma.prospectImportRow.createMany({
      data: inputs.map((input) => ({
        organizationId: input.organizationId,
        importId: input.importId,
        rowNumber: input.rowNumber,
        rawData: input.rawData as unknown as Prisma.InputJsonValue,
        normalizedData: (input.normalizedData ?? undefined) as unknown as Prisma.InputJsonValue,
        validationStatus: input.validationStatus,
        validationErrors: (input.validationErrors ?? []) as unknown as Prisma.InputJsonValue,
      })),
    });
    return this.findByImport(importId);
  }

  async deleteByImport(importId: string): Promise<void> {
    await this.prisma.prospectImportRow.deleteMany({ where: { importId } });
  }

  async markValidRowsExecutionState(importId: string, state: ProspectExecutionState): Promise<void> {
    await this.prisma.prospectImportRow.updateMany({
      where: { importId, validationStatus: 'VALID' },
      data: { executionState: state },
    });
  }

  /** ProspectIdentityResolver — one `UPDATE ... FROM (VALUES ...)` for the whole batch, never one per row. */
  async bulkSetResolvedIdentity(
    updates: Array<{ rowId: string; companyId: string | null; contactId: string }>,
    resolvedAt: Date,
    ctx?: TransactionContext,
  ): Promise<void> {
    if (updates.length === 0) return;
    const client = resolveClient(this.prisma, ctx);
    const values = Prisma.join(
      updates.map(
        (u) => Prisma.sql`(${u.rowId}::text, ${u.companyId}::text, ${u.contactId}::text)`,
      ),
    );
    await client.$executeRaw`
      UPDATE "prospect_import_rows" AS r
      SET "companyId" = v.company_id, "contactId" = v.contact_id, "resolvedAt" = ${resolvedAt}::timestamp
      FROM (VALUES ${values}) AS v(row_id, company_id, contact_id)
      WHERE r.id = v.row_id
    `;
  }
}
