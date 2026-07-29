import { Injectable } from '@nestjs/common';
import { Prisma, ProspectImport as PrismaImportRow } from '@prisma/client';
import {
  CreateProspectImportInput,
  ProspectColumnMapping,
  ProspectImport,
  ProspectImportStatus,
  UpdateProspectImportInput,
} from '../../../domain/prospect-import/prospect-import.entity';
import { ProspectImportRepository } from '../../../domain/prospect-import/prospect-import.repository';
import { PrismaService } from './prisma.service';

function toDomain(row: PrismaImportRow): ProspectImport {
  return {
    id: row.id,
    organizationId: row.organizationId,
    executionId: row.executionId,
    fileName: row.fileName,
    storageKey: row.storageKey,
    checksum: row.checksum,
    status: row.status as ProspectImportStatus,
    columnMapping: row.columnMapping as unknown as ProspectColumnMapping | null,
    totalRows: row.totalRows,
    validRows: row.validRows,
    invalidRows: row.invalidRows,
    duplicateRows: row.duplicateRows,
    excludedRows: row.excludedRows,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PrismaProspectImportRepository implements ProspectImportRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<ProspectImport | null> {
    const row = await this.prisma.prospectImport.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByExecution(executionId: string): Promise<ProspectImport | null> {
    const row = await this.prisma.prospectImport.findUnique({ where: { executionId } });
    return row ? toDomain(row) : null;
  }

  async create(input: CreateProspectImportInput): Promise<ProspectImport> {
    const row = await this.prisma.prospectImport.create({
      data: {
        organizationId: input.organizationId,
        executionId: input.executionId,
        fileName: input.fileName,
        storageKey: input.storageKey,
        checksum: input.checksum,
        createdBy: input.createdBy,
      },
    });
    return toDomain(row);
  }

  async update(id: string, input: UpdateProspectImportInput): Promise<ProspectImport> {
    const row = await this.prisma.prospectImport.update({
      where: { id },
      data: {
        status: input.status,
        columnMapping: input.columnMapping as unknown as Prisma.InputJsonValue,
        totalRows: input.totalRows,
        validRows: input.validRows,
        invalidRows: input.invalidRows,
        duplicateRows: input.duplicateRows,
        excludedRows: input.excludedRows,
      },
    });
    return toDomain(row);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.prospectImport.delete({ where: { id } });
  }
}
