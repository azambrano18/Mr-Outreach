import { Injectable } from '@nestjs/common';
import { Prisma, SequenceImportRow as PrismaSequenceImportRowRow } from '@prisma/client';
import {
  CreateSequenceImportRowInput,
  NormalizedImportRowData,
  SequenceImportRow,
  UpdateSequenceImportRowInput,
} from '../../../domain/sequence-import-row/sequence-import-row.entity';
import {
  BulkRowResult,
  SequenceImportRowFilter,
  SequenceImportRowRepository,
} from '../../../domain/sequence-import-row/sequence-import-row.repository';
import { TransactionContext } from '../../../domain/persistence/transaction';
import { PrismaService } from './prisma.service';
import { resolveClient } from './prisma-transaction-manager';

function toDomain(row: PrismaSequenceImportRowRow): SequenceImportRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    importId: row.importId,
    rowNumber: row.rowNumber,
    rawData: row.rawData as Record<string, string>,
    normalizedData: row.normalizedData as NormalizedImportRowData | null,
    companyRawName: row.companyRawName,
    email: row.email,
    validationStatus: row.validationStatus,
    validationErrors: row.validationErrors as unknown as string[],
    isDuplicate: row.isDuplicate,
    rejectionReason: row.rejectionReason,
    contactId: row.contactId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PrismaSequenceImportRowRepository implements SequenceImportRowRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<SequenceImportRow | null> {
    const row = await this.prisma.sequenceImportRow.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByImport(
    organizationId: string,
    importId: string,
    filter: SequenceImportRowFilter = {},
    ctx?: TransactionContext,
  ): Promise<SequenceImportRow[]> {
    const where: Prisma.SequenceImportRowWhereInput = { organizationId, importId };
    if (filter.validationStatus) where.validationStatus = filter.validationStatus as never;
    const rows = await resolveClient(this.prisma, ctx).sequenceImportRow.findMany({
      where,
      orderBy: { rowNumber: 'asc' },
    });
    return rows.map(toDomain);
  }

  async replaceForImport(
    organizationId: string,
    importId: string,
    rows: CreateSequenceImportRowInput[],
  ): Promise<SequenceImportRow[]> {
    return this.prisma.$transaction(async (tx) => {
      await tx.sequenceImportRow.deleteMany({ where: { organizationId, importId } });
      if (rows.length === 0) return [];
      await tx.sequenceImportRow.createMany({
        data: rows.map((input) => ({
          organizationId: input.organizationId,
          importId: input.importId,
          rowNumber: input.rowNumber,
          rawData: input.rawData as Prisma.InputJsonValue,
          normalizedData: (input.normalizedData ?? undefined) as Prisma.InputJsonValue | undefined,
          companyRawName: input.companyRawName ?? null,
          email: input.email ?? null,
          validationStatus: input.validationStatus,
          validationErrors: (input.validationErrors ?? []) as Prisma.InputJsonValue,
          isDuplicate: input.isDuplicate ?? false,
          rejectionReason: input.rejectionReason ?? null,
        })),
      });
      const created = await tx.sequenceImportRow.findMany({
        where: { organizationId, importId },
        orderBy: { rowNumber: 'asc' },
      });
      return created.map(toDomain);
    });
  }

  async update(id: string, input: UpdateSequenceImportRowInput): Promise<SequenceImportRow> {
    const row = await this.prisma.sequenceImportRow.update({ where: { id }, data: input });
    return toDomain(row);
  }

  /**
   * Fase 2, Caso B — a single `UPDATE ... FROM (VALUES ...)` statement for
   * however many rows are in the batch (never one UPDATE per row).
   */
  async bulkSetContactAndNormalizedData(updates: BulkRowResult[], ctx?: TransactionContext): Promise<void> {
    if (updates.length === 0) return;
    const client = resolveClient(this.prisma, ctx);
    const values = Prisma.join(
      updates.map(
        (u) =>
          // id/contactId are Prisma `String @id` — plain TEXT columns in
          // Postgres, never native uuid — cast accordingly or the join
          // below fails with "operator does not exist: text = uuid".
          Prisma.sql`(${u.rowId}::text, ${u.contactId}::text, ${JSON.stringify(u.normalizedData)}::jsonb)`,
      ),
    );
    await client.$executeRaw`
      UPDATE "sequence_import_rows" AS r
      SET "contactId" = v.contact_id, "normalizedData" = v.normalized_data, "updatedAt" = now()
      FROM (VALUES ${values}) AS v(row_id, contact_id, normalized_data)
      WHERE r.id = v.row_id
    `;
  }
}
