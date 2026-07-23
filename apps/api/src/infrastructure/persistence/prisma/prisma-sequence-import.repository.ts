import { Injectable } from '@nestjs/common';
import { Prisma, SequenceImport as PrismaSequenceImportRow } from '@prisma/client';
import {
  ColumnMapping,
  CreateSequenceImportInput,
  ImportRejection,
  SequenceImport,
  UpdateSequenceImportInput,
} from '../../../domain/sequence-import/sequence-import.entity';
import { SequenceImportRepository } from '../../../domain/sequence-import/sequence-import.repository';
import { PrismaService } from './prisma.service';

function toDomain(row: PrismaSequenceImportRow): SequenceImport {
  return {
    id: row.id,
    organizationId: row.organizationId,
    clientId: row.clientId,
    sequenceId: row.sequenceId,
    executiveId: row.executiveId,
    mailboxId: row.mailboxId,
    status: row.status,
    fileName: row.fileName,
    storageKey: row.storageKey,
    checksum: row.checksum,
    columnMapping: row.columnMapping as ColumnMapping | null,
    scenario: row.scenario,
    totalRows: row.totalRows,
    validRows: row.validRows,
    invalidRows: row.invalidRows,
    duplicateRows: row.duplicateRows,
    excludedRows: row.excludedRows,
    companiesDetected: row.companiesDetected,
    contactsAccepted: row.contactsAccepted,
    contactsRejected: row.contactsRejected,
    rejections: row.rejections as unknown as ImportRejection[],
    commandId: row.commandId,
    lastError: row.lastError,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PrismaSequenceImportRepository implements SequenceImportRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<SequenceImport | null> {
    const row = await this.prisma.sequenceImport.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findBySequence(organizationId: string, sequenceId: string): Promise<SequenceImport[]> {
    const rows = await this.prisma.sequenceImport.findMany({
      where: { organizationId, sequenceId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDomain);
  }

  async create(input: CreateSequenceImportInput): Promise<SequenceImport> {
    const row = await this.prisma.sequenceImport.create({
      data: {
        organizationId: input.organizationId,
        clientId: input.clientId,
        sequenceId: input.sequenceId,
        executiveId: input.executiveId,
        mailboxId: input.mailboxId,
        fileName: input.fileName,
        storageKey: input.storageKey,
        checksum: input.checksum,
        totalRows: input.totalRows,
        createdBy: input.createdBy,
      },
    });
    return toDomain(row);
  }

  async update(id: string, input: UpdateSequenceImportInput): Promise<SequenceImport> {
    const { rejections, columnMapping, ...rest } = input;
    const data: Prisma.SequenceImportUpdateInput = { ...rest };
    if (rejections) {
      data.rejections = rejections as unknown as Prisma.InputJsonValue;
    }
    if (columnMapping) {
      data.columnMapping = columnMapping as unknown as Prisma.InputJsonValue;
    }
    const row = await this.prisma.sequenceImport.update({ where: { id }, data });
    return toDomain(row);
  }
}
